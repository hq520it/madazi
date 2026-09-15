import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db/init.js';

/**
 * madazi License 验证（离线 RSA 验签，无需联网）
 *
 * License Key 格式：base64url(payload) + '.' + base64url(RSA-SHA256 签名)
 * payload = { lk, plan, seats, exp, dom, iss }
 *   lk  : 人类可读编号（MDZ-XXXX-XXXX）
 *   plan: 套餐 professional | team | enterprise
 *   seats: 席位
 *   exp : 到期日 YYYY-MM-DD
 *   dom : 绑定域名（null=不限域名）
 *   iss : 客户名称
 *
 * 门禁逻辑：
 *   - 未激活（DB 无记录或验签失败）→ 全站 403 LICENSE_REQUIRED
 *   - 已过期 → 全站 403 LICENSE_EXPIRED
 *   - 域名绑定且不匹配 → 403 LICENSE_DOMAIN_MISMATCH
 * 放行路径：/api/health、/api/license/*
 * 内存缓存：启动/激活时加载，到期按时间戳判断，无需每请求查库
 */

const PUBLIC_KEY = (process.env.LICENSE_PUBLIC_KEY || `-----BEGIN RSA PUBLIC KEY-----
MIIBCgKCAQEAyZc3e44MITpCLbAMBaWh4u0Lya6vPMUG3FKKXrcHJc5FBRfjbR57
4CB2JLbJS0FfBnPMJPZUqXr0phx3L4/aO5zfPEc7GU2ga6N6AtrcPK4NRZ7hElfW
jCi9ea2dqCM7MxHsGTnFpADDe+4ZYNUAA8hEkRmLmGO+pxGNq4VkayoKdgbtJbX1
xPnaGtQkHBkHoamcMv74xHwx87DTTJEPk0XKPE4CS1JvokQsAGpF59Aegj/VXUj9
KfU40qoJZMjkNsqRDMv3XKhgc+qli0PESTM75bl6jqzXkEPNuQK1fDBghSka8LWP
yw4kOztFB3nP9XkM/UTDTLmcIqJiNVARFQIDAQAB
-----END RSA PUBLIC KEY-----`).replace(/\\n/g, '\n');

const router = Router();

// 内存缓存（单例）
let cache = {
  loaded: false,
  activated: false,
  plan: null,
  seats: null,
  expiresAt: null,
  domain: null,
  issuedTo: null,
  licenseKey: null,
  activatedAt: null,
  lastError: null,
};

// 解析并验签 License Key，返回 payload 或 null
function verifyLicenseKey(key) {
  try {
    const [payloadB64, sigB64] = key.trim().split('.');
    if (!payloadB64 || !sigB64) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const ok = crypto.verify(
      'RSA-SHA256',
      Buffer.from(payloadB64, 'utf8'),
      PUBLIC_KEY,
      Buffer.from(sigB64, 'base64url')
    );
    return ok ? payload : null;
  } catch {
    return null;
  }
}

// 域名匹配：完全相等，或 hostname 是 domain 的子域名
function domainMatches(hostname, domain) {
  if (!domain) return true;
  const h = String(hostname || '').toLowerCase();
  const d = String(domain).toLowerCase();
  return h === d || h.endsWith('.' + d);
}

// 从 DB 加载 License 到内存缓存
async function loadLicense() {
  try {
    const { rows } = await db.query('SELECT license_key, plan, seats, expires_at, domain, issued_to, activated_at FROM licenses ORDER BY created_at DESC LIMIT 1');
    if (rows.length === 0) {
      cache = { loaded: true, activated: false, lastError: null };
      return cache;
    }
    const row = rows[0];
    const payload = verifyLicenseKey(row.license_key);
    if (!payload) {
      cache = { loaded: true, activated: false, lastError: 'license_key_invalid', licenseKey: row.license_key };
      return cache;
    }
    cache = {
      loaded: true,
      activated: true,
      plan: row.plan || payload.plan || 'professional',
      seats: row.seats || payload.seats || 5,
      expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : (payload.exp ? new Date(payload.exp + 'T23:59:59Z').getTime() : null),
      domain: row.domain || payload.dom || null,
      issuedTo: row.issued_to || payload.iss || null,
      licenseKey: row.license_key,
      activatedAt: row.activated_at ? new Date(row.activated_at).getTime() : null,
      lastError: null,
    };
  } catch (err) {
    cache = { loaded: true, activated: false, lastError: 'db_error' };
    console.error('[license] load failed:', err.message);
  }
  return cache;
}

// 查询激活状态（无需登录）
router.get('/status', async (req, res) => {
  if (!cache.loaded) await loadLicense();
  const expired = cache.activated && cache.expiresAt && Date.now() > cache.expiresAt;
  res.json({
    activated: cache.activated && !expired,
    needsActivation: !cache.activated,
    expired: expired,
    plan: cache.plan,
    seats: cache.seats,
    expiresAt: cache.expiresAt,
    domain: cache.domain,
    issuedTo: cache.issuedTo,
    activatedAt: cache.activatedAt,
  });
});

// 激活（无需登录，粘贴 License Key）
router.post('/activate', async (req, res) => {
  const key = (req.body?.key || '').trim();
  if (!key) {
    return res.status(400).json({ error: 'License Key 不能为空' });
  }
  const payload = verifyLicenseKey(key);
  if (!payload) {
    return res.status(400).json({ error: 'License Key 无效或签名不匹配，请检查后重试' });
  }
  // 域名绑定校验：payload.dom 有值且当前访问域名不匹配 → 拒绝
  if (payload.dom && !domainMatches(req.hostname, payload.dom)) {
    return res.status(403).json({
      error: 'License 绑定域名不匹配',
      detail: `此 License 绑定域名 ${payload.dom}，当前访问 ${req.hostname}。如需迁移请联系厂商。`,
    });
  }
  // 过期校验
  if (payload.exp) {
    const exp = new Date(payload.exp + 'T23:59:59Z').getTime();
    if (Date.now() > exp) {
      return res.status(403).json({ error: 'License 已过期，请联系厂商续费' });
    }
  }

  const id = crypto.randomUUID();
  const activatedAt = new Date();
  await db.query(
    `INSERT INTO licenses (id, license_key, plan, seats, expires_at, domain, issued_to, activated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING`,
    [id, key, payload.plan || 'professional', payload.seats || 5,
     payload.exp ? new Date(payload.exp + 'T23:59:59Z') : null,
     payload.dom || null, payload.iss || null, activatedAt]
  );
  // 旧 license 覆盖逻辑：只保留最新一条（简单起见删除旧记录）
  await db.query('DELETE FROM licenses WHERE id <> $1', [id]);

  await loadLicense();
  res.json({ activated: true, message: '激活成功' });
});

// 门禁中间件：全局挂载（/api 下），未激活/过期/域名不匹配 → 403
export async function licenseGate(req, res, next) {
  const url = req.originalUrl || '';
  // 放行健康检查与 License 接口本身
  if (url.startsWith('/api/health') || url.startsWith('/api/license')) {
    return next();
  }
  if (!cache.loaded) await loadLicense();
  if (!cache.activated) {
    return res.status(403).json({ error: 'LICENSE_REQUIRED', message: '系统未激活，请联系厂商获取 License' });
  }
  if (cache.expiresAt && Date.now() > cache.expiresAt) {
    return res.status(403).json({ error: 'LICENSE_EXPIRED', message: 'License 已过期，请联系厂商续费' });
  }
  // 集群内部访问（dsh-web pod → madazi-server service DNS / pod IP / 本地调试）不受域名绑定限制
  const internalHost = String(req.hostname || '').toLowerCase();
  const isInternal = internalHost === 'madazi-server'
    || internalHost.endsWith('.cluster.local')
    || /^(127\.0\.0\.1|localhost)$/.test(internalHost)
    || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(internalHost);
  if (cache.domain && !domainMatches(req.hostname, cache.domain) && !isInternal) {
    return res.status(403).json({ error: 'LICENSE_DOMAIN_MISMATCH', message: `License 绑定域名 ${cache.domain}，当前访问 ${req.hostname}` });
  }
  next();
}

// 供管理端/运维查询完整状态（含 licenseKey 掩码）
export async function getLicenseStatus() {
  if (!cache.loaded) await loadLicense();
  return { ...cache, licenseKey: cache.licenseKey ? cache.licenseKey.slice(0, 8) + '…' : null };
}

export default router;
