#!/usr/bin/env node
// plugin-verify.js —— 安装后握手验证（2026-08-19，阶段 1）
// 用法：node src/scripts/plugin-verify.js [pluginName]
// 行为：cwd=PROFILE_DIR 起 SDK demo bin（/app/node_modules 解析链），发 initialize 帧，
//       60s 内收到 serverInfo → 整个 cordis.yml 插件树加载成功 → exit 0；否则 exit 1 并打错误。
// ★ 插件名只作日志标注（验证对象是整体 cordis.yml 加载——新装插件已包含在树里）
import { spawn } from 'node:child_process';
import path from 'node:path';

const PROFILE_DIR = process.env.DSH_PROFILE_DIR || '/app/generated/.dsh/profile';
// bin/cordis.yml 从 PROFILE_DIR 解析（生产=/app/generated/.dsh/profile，本地可覆盖）
const BIN = path.join(PROFILE_DIR, 'node_modules/.bin/dsh-jsonrpc-agent');
const CONFIG = path.join(PROFILE_DIR, 'cordis.yml');
const pluginName = process.argv[2] || '(unknown)';
const timeoutMs = 60000;

// ★ web profile（dsh-web 加载的 $DSH_HOME/profiles/web）不含 SDK agent bin
//   （dsh-jsonrpc-agent 属 agent 任务 profile），spawn 必然 ENOENT。
//   此时降级为文件级一致性验证：cordis.yml 条目引用的每个 name 必须在
//   package.json dependencies 里、且在 node_modules 中存在——挡住
//   「pnpm 未装上 / cordis 条目标错」两类失败；进程级握手验证保留给
//   有 agent bin 的 profile。
import fs, { existsSync } from 'node:fs';
if (!existsSync(BIN)) {
  try {
    const pkgPath = path.join(PROFILE_DIR, 'package.json');
    if (!existsSync(pkgPath)) throw new Error(`package.json not found at ${PROFILE_DIR}`);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = pkg.dependencies || {};
    const bundles = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : null;
    const resolve = (n) => existsSync(path.join(PROFILE_DIR, 'node_modules', ...n.split('/')));
    const errors = [];
    let cordisRefs = 0;
    // ★ bundle 组合式（web profile，cordis.yml 固定 []）：本次安装的插件必须已入
    //   dsh.profile.bundles 且 node_modules 可解析；既有 bundle（dsh-base/web-app/
    //   madazi 平台插件等）由镜像全局树/initContainer symlink 提供，不要求进 dependencies。
    if (bundles && pluginName !== '(unknown)') {
      if (!bundles.includes(pluginName)) errors.push(`bundle 未加入 dsh.profile.bundles: ${pluginName}`);
      else if (!resolve(pluginName)) errors.push(`bundle 已声明但 node_modules 缺失: ${pluginName}`);
    }
    // 条目式（旧任务 profile）：cordis.yml 引用的每个 name 必须在 dependencies 且可解析
    const lines = fs.readFileSync(CONFIG, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(/^\s*name:\s*['"]?([^'"]+)['"]?\s*$/);
      if (m) {
        cordisRefs++;
        const n = m[1];
        if (!(n in deps)) errors.push(`cordis.yml 引用但未在 dependencies: ${n}`);
        else if (!resolve(n)) errors.push(`cordis.yml 引用但未安装: ${n}`);
      }
    }
    if (errors.length) {
      console.error(`VERIFY-FAIL: ${errors.join('; ')} (profile=${PROFILE_DIR})`);
      process.exit(1);
    }
    const scope = bundles ? `bundles=${bundles.length}` : `cordis entries=${cordisRefs}`;
    console.log(`VERIFY-OK: file-level consistency (${scope}) plugin=${pluginName}`);
    process.exit(0);
  } catch (e) {
    console.error(`VERIFY-FAIL: ${e.message}`);
    process.exit(1);
  }
}

const child = spawn(BIN, [CONFIG], {
  cwd: PROFILE_DIR,
  env: { ...process.env, HOME: '/tmp' },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buf = '';
let done = false;
const timer = setTimeout(() => {
  if (!done) {
    done = true;
    console.error(`VERIFY-FAIL: timeout after ${timeoutMs / 1000}s (plugin=${pluginName})`);
    child.kill('SIGKILL');
    process.exit(1);
  }
}, timeoutMs);

child.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  const i = buf.indexOf('\n');
  if (i >= 0) {
    const line = buf.slice(0, i);
    let frame;
    try { frame = JSON.parse(line); } catch { return; }
    if (frame?.result?.serverInfo) {
      done = true;
      console.log(`VERIFY-OK: serverInfo=${JSON.stringify(frame.result.serverInfo)} plugin=${pluginName}`);
      child.kill('SIGKILL');
      clearTimeout(timer);
      process.exit(0);
    }
    if (frame?.error) {
      done = true;
      console.error(`VERIFY-FAIL: ${frame.error.message || JSON.stringify(frame.error)} plugin=${pluginName}`);
      child.kill('SIGKILL');
      clearTimeout(timer);
      process.exit(1);
    }
  }
});

child.stderr.on('data', (d) => {
  const s = d.toString('utf8');
  if (/VERIFY-FAIL|SyntaxError|Cannot find module|ERR_/.test(s)) {
    done = true;
    console.error(s.trim().slice(0, 500));
    child.kill('SIGKILL');
    clearTimeout(timer);
    process.exit(1);
  }
});

child.on('error', (e) => {
  done = true;
  console.error(`VERIFY-FAIL: ${e.message}`);
  clearTimeout(timer);
  process.exit(1);
});

child.on('exit', (code) => {
  if (!done) {
    done = true;
    console.error(`VERIFY-FAIL: agent exited early code=${code}`);
    clearTimeout(timer);
    process.exit(1);
  }
});

child.stdin.write(JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { cwd: '/tmp', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
}) + '\n');
