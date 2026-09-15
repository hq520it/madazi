// DSH 插件市场后端 API（2026-08-19，阶段 1）
// 操作共享 PVC profile：/app/generated/.dsh/profile（server pod 视角），本地开发用 DSH_PROFILE_DIR 覆盖
// 安全：全 adminOnly + execFile 数组参数（name 白名单校验防注入）+ 写前备份 + 幂等
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { auth, adminOnly } from '../middleware/auth.js';
import { getRedis } from '../services/redis.js';
import { k8sRequest } from '../services/dsh-container-k8s.js';

const execFileP = promisify(execFile);
const router = Router();
router.use(auth, adminOnly);

const PROFILE_DIR = process.env.DSH_PROFILE_DIR || '/app/generated/.dsh/profile';
const LOG_DIR = process.env.DSH_PLUGIN_LOG_DIR || path.join(PROFILE_DIR, '..', 'plugin-logs');
const REGISTRY = 'https://registry.npmmirror.com';
// 已知坏 latest 标签的包（npm latest 指向坏 rc.1 等）——预检红警
const BAD_LATEST = new Set(['dsh-settings']);

// 插件名白名单：@scope/name、name、可选版本段（防注入：execFile 数组参数 + 字符集校验）
const NAME_RE = /^@[a-z0-9-]+\/[a-z0-9-]+$|^[a-z0-9-]+$/;
const VER_RE = /^[a-z0-9][a-z0-9.+-]*$/;

function profilePath(...seg) {
  return path.join(PROFILE_DIR, ...seg);
}

function pluginLogPath(ts) {
  return path.join(LOG_DIR, `${ts}.log`);
}

// 当前 cordis.yml 条目（数组）——文件缺失返回 []
// ★ 不解析 yaml：DSH 的 !!js 扩展表达式可跨行，js-yaml 无法容忍；
//   name/id 结构固定（`- id:` / `name:`），文本级提取即可
function readCordisEntries() {
  const p = profilePath('cordis.yml');
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  const entries = [];
  let cur = null;
  for (const line of lines) {
    const idM = line.match(/^\s*-\s*id:\s*(\S+)/);
    const nameM = line.match(/^\s*name:\s*['"]?([^'"]+)['"]?\s*$/);
    if (idM) {
      cur = { id: idM[1] };
      entries.push(cur);
    } else if (nameM && cur) {
      cur.name = nameM[1];
    }
  }
  return entries;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ★ cordis.patch.yml（插件声明的挂载模板）：读取 insert 段条目（id/name）
//   正确 id 由插件作者定义（dsh-attachments → id: attachments），不是包名；
//   用包名会导致 cordis 服务名错位 → 依赖方 pending（生产实测踩坑）。
//   仅提取 id/name（当前生态插件条目仅这两字段；config 复杂场景暂不展开）。
function parseCordisPatch(pkgName) {
  const p = profilePath('node_modules', pkgName, 'cordis.patch.yml');
  if (!fs.existsSync(p)) return null;
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  const entries = [];
  let cur = null;
  for (const line of lines) {
    if (/^\s*-?\s*insert:/.test(line.trim())) continue;
    const idM = line.match(/^\s+-\s*id:\s*['"]?([^'"]+)['"]?\s*$/);
    const nameM = line.match(/^\s+name:\s*['"]?([^'"]+)['"]?\s*$/);
    if (idM) {
      cur = { id: idM[1] };
      entries.push(cur);
    } else if (nameM && cur && !cur.name) {
      cur.name = nameM[1];
    }
  }
  return entries.length ? entries : null;
}

// pnpm-workspace.yaml allowBuilds 自动补（pnpm 11 原生构建白名单）
// pnpm add 报 ERR_PNPM_IGNORED_BUILDS → 检测包名 → 写 allowBuilds: true → 返回 changed
function ensureAllowBuilds(pkgs) {
  const ws = profilePath('pnpm-workspace.yaml');
  if (!fs.existsSync(ws)) return false;
  let s = fs.readFileSync(ws, 'utf8');
  const hasTrue = (pkg) => new RegExp(`^\\s*${escapeRe(pkg)}:\\s*true\\s*$`, 'm').test(s);
  let changed = false;
  for (const pkg of pkgs) {
    if (hasTrue(pkg)) continue;
    const ph = new RegExp(`^(\\s*)${escapeRe(pkg)}:\\s*set this to true or false\\s*$`, 'm');
    if (ph.test(s)) {
      s = s.replace(ph, `$1${pkg}: true`);
      changed = true;
    }
  }
  const missing = pkgs.filter((pkg) => !hasTrue(pkg));
  if (missing.length) {
    if (/^allowBuilds:\s*$/m.test(s)) {
      s = s.replace(/^(allowBuilds:\s*)$/m, `$1\n${missing.map((p) => `  ${p}: true`).join('\n')}`);
    } else if (/^onlyBuiltDependencies:/m.test(s)) {
      s = s.replace(/^(onlyBuiltDependencies:\s*)$/m, `$1\n${missing.map((p) => `  - ${p}`).join('\n')}`);
    } else {
      s += `\nallowBuilds:\n${missing.map((p) => `  ${p}: true`).join('\n')}\n`;
    }
    changed = true;
  }
  if (changed) fs.writeFileSync(ws, s);
  return changed;
}

// ★ cordis.yml 不能 yaml dump 重建（会破坏 !!js 等 DSH 扩展）——写一律文本级 + 备份
function backupCordis() {
  const p = profilePath('cordis.yml');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (fs.existsSync(p)) fs.copyFileSync(p, `${p}.bak-${Date.now()}`);
}

// 尾部追加 entry 块（YAML 顶层序列可分段——缩进 0 的 `- ` 合法）
// id 可选：插件 cordis.patch.yml 声明的正确 id（如 attachments）；缺省用包名派生
function appendCordisEntry(name, id) {
  backupCordis();
  const p = profilePath('cordis.yml');
  const block = `\n- id: ${id || shortId(name)}\n  name: '${name}'\n`;
  fs.appendFileSync(p, block);
}

// 块级删除（锚定 `- id:` 起始块 + 块内 name 匹配；不动其他内容）
function removeCordisEntry(name) {
  backupCordis();
  const p = profilePath('cordis.yml');
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  const out = [];
  let i = 0;
  let removed = false;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*-\s*id:/.test(line)) {
      const block = [line];
      let j = i + 1;
      while (j < lines.length && !/^\s*-\s*id:/.test(lines[j])) { block.push(lines[j]); j++; }
      const blockText = block.join('\n');
      if (blockText.includes(`name: '${name}'`) || blockText.includes(`name: "${name}"`) || blockText.includes(`name: ${name}`)) {
        removed = true;
        i = j; // 跳过整个块
        continue;
      }
      out.push(...block);
      i = j;
    } else {
      out.push(line);
      i++;
    }
  }
  fs.writeFileSync(p, out.join('\n'));
  return removed;
}

function shortId(name) {
  return name.split('/').pop().replace(/^dsh-/, 'dsh-');
}

// ★ web profile 是 bundle 组合式：cordis.yml 固定为 []（根配置空序列），插件树由
//   package.json.dsh.profile.bundles 按序叠 patch 层 + cordis.patch.yml 组成。
//   往 cordis.yml 追加条目会破坏 [] 根格式 → 安装/启用/卸载必须走 bundles。
function isBundleProfile() {
  const pkgPath = profilePath('package.json');
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return Array.isArray(pkg?.dsh?.profile?.bundles);
  } catch { return false; }
}

function readBundles() {
  const pkgPath = profilePath('package.json');
  if (!fs.existsSync(pkgPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8'))?.dsh?.profile?.bundles || [];
  } catch { return []; }
}

function writeBundles(bundles) {
  const pkgPath = profilePath('package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (!pkg.dsh) pkg.dsh = {};
  if (!pkg.dsh.profile) pkg.dsh.profile = {};
  pkg.dsh.profile.bundles = [...new Set(bundles)];
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

// 把插件注册进当前 profile：bundle 式 → dsh.profile.bundles；条目式 → cordis.yml 追加
function registerPlugin(name, id, writeLog) {
  const bundleMode = isBundleProfile();
  if (bundleMode) {
    const bundles = readBundles();
    if (bundles.includes(name)) {
      writeLog(`bundle 已存在（幂等跳过: ${name}）`);
      return;
    }
    writeBundles([...bundles, name]);
    writeLog(`package.json dsh.profile.bundles + ${name}`);
    return;
  }
  const exists = readCordisEntries().some((x) => x.name === name);
  if (exists) {
    writeLog(`cordis.yml entry 已存在（幂等跳过）`);
    return;
  }
  const patchEntries = parseCordisPatch(name);
  if (patchEntries && patchEntries.length) {
    for (const entry of patchEntries) {
      const target = entry.name || name;
      if (readCordisEntries().some((x) => x.name === target)) {
        writeLog(`cordis.yml entry 已存在（幂等跳过: ${target}）`);
        continue;
      }
      appendCordisEntry(target, entry.id);
      writeLog(`cordis.yml + ${target} (id=${entry.id})`);
    }
  } else {
    appendCordisEntry(name);
    writeLog(`cordis.yml + ${name}`);
  }
}

// 从 profile 移除插件注册（与 registerPlugin 对应的回滚/卸载逻辑）
function unregisterPlugin(name) {
  if (isBundleProfile()) {
    const before = readBundles();
    const after = before.filter((b) => b !== name);
    if (after.length !== before.length) {
      writeBundles(after);
      return true;
    }
    return false;
  }
  return removeCordisEntry(name);
}

// ---------- GET / 已装列表 ----------
router.get('/', async (req, res) => {
  try {
    const pkgPath = profilePath('package.json');
    const deps = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')).dependencies || {} : {};
    const bundleMode = isBundleProfile();
    const entries = readCordisEntries();
    const entryNames = new Set(entries.map((e) => e.name));
    const bundleNames = bundleMode ? new Set(readBundles()) : new Set();
    const list = Object.entries(deps).map(([name, version]) => ({
      name,
      version,
      enabled: bundleMode ? bundleNames.has(name) : entryNames.has(name),
      active: null,
    }));
    try {
      const redis = await getRedis();
      if (redis) {
        for (const item of list) {
          const st = await redis.get(`dsh:plugin:status:${item.name}`);
          item.active = st || null;
        }
      }
    } catch { /* Redis 不可用降级（active=null） */ }
    res.json({ ok: true, plugins: list, cordisEntries: entries.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- GET /search?q= ---------- 代理 npmmirror 搜索
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ ok: true, results: [] });
  try {
    const r = await fetch(`${REGISTRY}/-/v1/search?text=${encodeURIComponent(q)}&size=20`);
    if (!r.ok) return res.status(502).json({ ok: false, error: `registry ${r.status}` });
    const data = await r.json();
    const results = (data.objects || []).map((o) => ({
      name: o.package?.name,
      version: o.package?.version,
      description: o.package?.description || '',
      publisher: o.package?.publisher?.username || '',
    }));
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- GET /precheck?name= ---------- dist-tags + 依赖 + 已知坏包
router.get('/precheck', async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name || !NAME_RE.test(name)) return res.status(400).json({ ok: false, error: 'invalid name' });
  try {
    const r = await fetch(`${REGISTRY}/${encodeURIComponent(name)}`);
    if (r.status === 404) return res.status(404).json({ ok: false, error: 'not found' });
    if (!r.ok) return res.status(502).json({ ok: false, error: `registry ${r.status}` });
    const doc = await r.json();
    const warnings = [];
    const tags = doc['dist-tags'] || {};
    if (BAD_LATEST.has(name)) warnings.push({ level: 'red', text: '该包 latest 标签已知损坏（dsh-settings 官方 bug），建议安装 @next 版本' });
    if (tags.latest && /rc|beta|alpha/.test(tags.latest)) warnings.push({ level: 'yellow', text: `latest=${tags.latest} 是预发布版，可能存在问题；next=${tags.next || '-'}` });
    if (!tags.next && tags.latest) warnings.push({ level: 'yellow', text: `无 next 标签，latest=${tags.latest}` });
    res.json({
      ok: true,
      name,
      latest: tags.latest || null,
      next: tags.next || null,
      dependencies: doc.versions?.[tags.next || tags.latest]?.dependencies || {},
      peerDependencies: doc.versions?.[tags.next || tags.latest]?.peerDependencies || {},
      warnings,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- POST /install {name, version?} ----------
router.post('/install', async (req, res) => {
  const { name, version } = req.body || {};
  if (!name || !NAME_RE.test(name)) return res.status(400).json({ ok: false, error: 'invalid name' });
  if (version !== undefined && !VER_RE.test(version)) return res.status(400).json({ ok: false, error: 'invalid version' });
  try {
    if (!fs.existsSync(profilePath('package.json'))) {
      return res.status(500).json({ ok: false, error: `profile not found at ${PROFILE_DIR}` });
    }
    const ts = Date.now();
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const logFile = pluginLogPath(ts);
    const writeLog = (s) => fs.appendFileSync(logFile, s + '\n');

    // 1) pnpm add（npmmirror 源）——标签动态选择：有 next（rc 修复版）用 next，否则 latest
    let spec;
    if (version) {
      spec = `${name}@${version}`;
    } else {
      let tag = 'next';
      try {
        const { stdout } = await execFileP('npm', ['view', name, 'dist-tags', '--json', '--registry', REGISTRY], { timeout: 30000, maxBuffer: 1024 * 1024 });
        const tags = JSON.parse(stdout);
        if (!tags || !tags.next) tag = 'latest';
      } catch { tag = 'latest'; }
      spec = `${name}@${tag}`;
    }
    writeLog(`$ pnpm add ${spec}`);
    try {
      const { stdout, stderr } = await execFileP('pnpm', ['add', spec], {
        cwd: PROFILE_DIR,
        env: { ...process.env, npm_config_registry: REGISTRY },
        timeout: 300000,
        maxBuffer: 1024 * 1024 * 8,
      });
      writeLog(stdout.trim() + '\n' + stderr.trim());
    } catch (e) {
      // ★ allowBuilds 自动补：pnpm 11 报 ERR_PNPM_IGNORED_BUILDS（原生构建被拒）→ 白名单补写后重试一次
      const out = `${e.stdout || ''}\n${e.stderr || ''}`;
      const ignored = (out.match(/Ignored build scripts: ([^\n]+)/) || [])[1] || '';
      const pkgs = ignored.split(',').map((s) => s.trim().replace(/@\d+[.\w-]*$/, '')).filter(Boolean);
      if (pkgs.length && ensureAllowBuilds(pkgs)) {
        writeLog(`allowBuilds 自动补写: ${pkgs.join(', ')} → 重试`);
        try {
          const { stdout, stderr } = await execFileP('pnpm', ['add', spec], {
            cwd: PROFILE_DIR,
            env: { ...process.env, npm_config_registry: REGISTRY },
            timeout: 300000,
            maxBuffer: 1024 * 1024 * 8,
          });
          writeLog(stdout.trim() + '\n' + stderr.trim());
        } catch (e2) {
          const out2 = `${e2.stdout || ''}\n${e2.stderr || ''}`;
          const detail2 = (e2.stderr || '').trim() || out2.trim().slice(-800) || e2.message;
          writeLog(`INSTALL-FAIL(exit=${e2.code}): ${detail2}`);
          return res.status(500).json({ ok: false, error: detail2, log: ts });
        }
      } else {
        const detail = (e.stderr || '').trim() || out.trim().slice(-800) || e.message;
        writeLog(`INSTALL-FAIL(exit=${e.code}): ${detail}`);
        return res.status(500).json({ ok: false, error: detail, log: ts });
      }
    }

    // 2) 注册进 profile：bundle 式（web）→ dsh.profile.bundles；条目式（旧任务 profile）→ cordis.yml 追加
    // ★ bundle 式优先应用插件自带 cordis.patch.yml（insert 段声明正确 id/name）——由 dsh
    //   profile-boot 按 bundles 顺序自动叠 patch 层，无需（也不能）改动 cordis.yml 根文件
    registerPlugin(name, null, writeLog);

    // 3) 握手验证（整体 cordis.yml 加载）
    let verify = null;
    try {
      const script = fileURLToPath(new URL('../scripts/plugin-verify.js', import.meta.url));
      const { stdout } = await execFileP('node', [script, name], {
        cwd: PROFILE_DIR,
        env: { ...process.env, npm_config_registry: REGISTRY },
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 2,
      });
      verify = { ok: true, detail: stdout.trim().slice(0, 500) };
      writeLog(`verify: ok`);
    } catch (e) {
      verify = { ok: false, detail: (e.stderr || e.message).slice(0, 500) };
      writeLog(`verify: fail — ${verify.detail}`);
      // ★ verify 失败 = 插件树加载失败 = pending 条目阻塞 agent 启动（生产任务全挂）
      //   自动回滚：移除 bundles/cordis 注册 + pnpm remove，保证下次任务不受影响
      writeLog(`verify 失败 → 自动回滚 ${name}`);
      try { unregisterPlugin(name); } catch { /* 忽略 */ }
      try {
        await execFileP('pnpm', ['remove', name], { cwd: PROFILE_DIR, env: { ...process.env, npm_config_registry: REGISTRY }, timeout: 300000, maxBuffer: 1024 * 1024 * 8 });
      } catch { /* 忽略（remove 失败不阻断） */ }
      try {
        const redis = await getRedis();
        if (redis) await redis.del(`dsh:plugin:status:${name}`);
      } catch { /* 忽略 */ }
      return res.status(200).json({ ok: false, installed: name, rollback: true, verify, log: ts });
    }

    // 4) Redis 状态
    try {
      const redis = await getRedis();
      if (redis) await redis.set(`dsh:plugin:status:${name}`, verify.ok ? 'ok' : 'fail', 'EX', 86400);
    } catch { /* Redis 失败不阻断 */ }

    res.json({ ok: true, installed: name, version: version || 'next', verify, log: ts });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- POST /uninstall {name} ----------
router.post('/uninstall', async (req, res) => {
  const { name } = req.body || {};
  if (!name || !NAME_RE.test(name)) return res.status(400).json({ ok: false, error: 'invalid name' });
  try {
    if (!fs.existsSync(profilePath('package.json'))) {
      return res.status(500).json({ ok: false, error: `profile not found at ${PROFILE_DIR}` });
    }
    unregisterPlugin(name);
    let removed = true;
    try {
      await execFileP('pnpm', ['remove', name], { cwd: PROFILE_DIR, env: { ...process.env, npm_config_registry: REGISTRY }, timeout: 300000, maxBuffer: 1024 * 1024 * 8 });
    } catch (e) {
      removed = false;
      if (!/not installed|ENOENT|no such/.test(e.stderr || '')) {
        return res.status(500).json({ ok: false, error: e.stderr || e.message });
      }
    }
    try {
      const redis = await getRedis();
      if (redis) await redis.del(`dsh:plugin:status:${name}`);
    } catch { /* 忽略 */ }
    res.json({ ok: true, removed });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- POST /enable {name} ---------- bundle 式：加入 bundles；条目式：cordis.yml 幂等追加
router.post('/enable', async (req, res) => {
  const { name } = req.body || {};
  if (!name || !NAME_RE.test(name)) return res.status(400).json({ ok: false, error: 'invalid name' });
  try {
    if (isBundleProfile()) {
      const bundles = readBundles();
      if (bundles.includes(name)) return res.json({ ok: true, already: true });
      writeBundles([...bundles, name]);
      return res.json({ ok: true, enabled: name });
    }
    if (readCordisEntries().some((x) => x.name === name)) return res.json({ ok: true, already: true });
    appendCordisEntry(name);
    res.json({ ok: true, enabled: name });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- POST /disable {name} ---------- bundle 式：移出 bundles；条目式：cordis.yml 移除
router.post('/disable', async (req, res) => {
  const { name } = req.body || {};
  if (!name || !NAME_RE.test(name)) return res.status(400).json({ ok: false, error: 'invalid name' });
  try {
    if (isBundleProfile()) {
      const bundles = readBundles();
      if (!bundles.includes(name)) return res.json({ ok: true, already: true });
      writeBundles(bundles.filter((b) => b !== name));
      return res.json({ ok: true, disabled: name });
    }
    const removed = removeCordisEntry(name);
    if (!removed) return res.json({ ok: true, already: true });
    res.json({ ok: true, disabled: name });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- POST /restart ---------- 重启 dsh-web（安装插件后刷新 boot 树用）
// ★ 原理：dsh web 进程缓存 boot 树（改 bundles 后旧进程吐旧树），必须重启才生效。
//   DELETE pod → deployment 自动重建（chaos 实测 ~14s 重生、会话 PVC 持久化保留）。
//   前端轮询 GET /restart/status 判就绪——/api/admin/* 走 traefik 平台家族直达
//   server，不经过 dsh-web pod，轮询不受重启影响。
router.post('/restart', async (req, res) => {
  try {
    const pods = await k8sRequest('GET', '/pods?labelSelector=app%3Dmadazi-dsh-web');
    const items = pods.items || [];
    if (!items.length) return res.status(404).json({ ok: false, error: 'no dsh-web pods found' });
    for (const p of items) {
      try { await k8sRequest('DELETE', `/pods/${p.metadata.name}`); } catch (e) {
        return res.status(500).json({ ok: false, error: `delete ${p.metadata.name}: ${e.message}` });
      }
    }
    res.json({ ok: true, deleted: items.length, restarting: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- GET /restart/status ---------- dsh-web pod 就绪状态（前端轮询）
router.get('/restart/status', async (req, res) => {
  try {
    const pods = await k8sRequest('GET', '/pods?labelSelector=app%3Dmadazi-dsh-web');
    const items = (pods.items || []).map((p) => ({
      name: p.metadata.name,
      phase: p.status?.phase,
      ready: (p.status?.conditions || []).some((c) => c.type === 'Ready' && c.status === 'True'),
    }));
    res.json({ ok: true, ready: items.some((i) => i.phase === 'Running' && i.ready), pods: items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- GET /logs?task=<ts> ---------- 安装日志尾部
router.get('/logs', async (req, res) => {
  const task = String(req.query.task || '');
  if (!/^\d+$/.test(task)) return res.status(400).json({ ok: false, error: 'invalid task' });
  const p = pluginLogPath(task);
  if (!fs.existsSync(p)) return res.status(404).json({ ok: false, error: 'log not found' });
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  res.json({ ok: true, lines: lines.slice(-100) });
});

export default router;
