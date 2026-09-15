import crypto from 'crypto';

/**
 * LLM API Key 加密存储（P0-3）
 * - AES-256-GCM，输出格式: enc:v1:base64(iv):base64(tag):base64(cipher)
 * - 主密钥来自环境变量 KEY_MASTER_SECRET（32 字节 hex）；缺失时拒绝加解密（防静默降级）
 * - 非 enc: 前缀的值原样返回（兼容迁移前的明文数据）
 */

const PREFIX = 'enc:v1:';

function masterKey() {
  const s = process.env.KEY_MASTER_SECRET;
  if (!s) {
    throw new Error('KEY_MASTER_SECRET 环境变量缺失，无法加解密 LLM API Key');
  }
  // 兼容 hex(64) 或任意长度 raw 字符串（不足 32 字节时散列扩展）
  const buf = /^[0-9a-f]{64}$/i.test(s) ? Buffer.from(s, 'hex') : crypto.createHash('sha256').update(s).digest();
  return buf;
}

export function encryptKey(plain) {
  if (!plain) return plain;
  if (plain.startsWith(PREFIX)) return plain; // 幂等
  const key = masterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptKey(stored) {
  if (!stored) return stored;
  if (!stored.startsWith(PREFIX)) return stored; // 明文旧数据，原样返回
  const key = masterKey();
  const parts = stored.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return stored;
  const [ivB64, tagB64, dataB64] = parts;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    // 密钥不匹配或数据损坏：返回原串避免崩溃，由日志层暴露问题
    return stored;
  }
}

export function isEncrypted(stored) {
  return !!stored && stored.startsWith(PREFIX);
}
