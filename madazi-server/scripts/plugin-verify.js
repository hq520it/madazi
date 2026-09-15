// DSH 插件安装握手验证（node plugin-verify.js <plugin-name>）
// 用途：install API 在「注册 bundle + 重启 dsh-web」之前做预检——确认被装插件
//       注册在位、模块可加载、cordis.patch.yml 合法，避免坏插件重启后整棵树
//       加载失败 → dsh-web 起不来 / agent 任务全 pending（生产事故）。
// 运行环境：cwd = profile 目录（/app/generated/.dsh/profiles/web），argv[2] = 插件包名。
// 约定：通过打印 detail 到 stdout、退出码 0；失败打印原因到 stderr、退出码非 0
//       （install API 据此自动回滚：移除 bundles 注册 + pnpm remove）。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const name = process.argv[2];
if (!name) {
  console.error('usage: node plugin-verify.js <plugin-name>');
  process.exit(2);
}

const cwd = process.cwd();
const pkgPath = path.join(cwd, 'package.json');
const cordisPath = path.join(cwd, 'cordis.yml');

// 1. 注册在位（bundle 式 dsh.profile.bundles 或 条目式 cordis.yml name）
let inBundles = false;
let inCordis = false;
try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const bundles = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : [];
  inBundles = bundles.includes(name);
} catch (e) {
  console.error(`VERIFY-FAIL: 读取 profile package.json 失败: ${e.message}`);
  process.exit(1);
}
if (fs.existsSync(cordisPath)) {
  const lines = fs.readFileSync(cordisPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*name:\s*['"]?([^'"]+)['"]?\s*$/);
    if (m && m[1] === name) { inCordis = true; break; }
  }
}
if (!inBundles && !inCordis) {
  console.error(`VERIFY-FAIL: ${name} 未注册进 profile（bundles/cordis.yml 均无），安装未生效`);
  process.exit(1);
}

// 2. 模块可加载（node 24 支持 require(esm)；cwd=profile 使解析命中其 node_modules）
let mod;
try {
  const requireFromProfile = createRequire(pkgPath);
  mod = requireFromProfile(name);
} catch (e) {
  console.error(`VERIFY-FAIL: 无法加载插件模块 ${name}: ${e.message}`);
  process.exit(1);
}
const looksPlugin = mod && (typeof mod.apply === 'function' || typeof mod === 'function' || (typeof mod === 'object' && mod.name));
if (!looksPlugin) {
  // 非典型导出（纯 client / 特殊形状）：不硬拦，提示人工确认
  console.warn(`VERIFY-WARN: ${name} 导出形态非典型 cordis 插件（无 apply/name），已加载但请人工确认`);
}

// 3. cordis.patch.yml 合法（若有）：必须有 insert 段且至少一个服务 id
const patchPath = path.join(cwd, 'node_modules', name, 'cordis.patch.yml');
let patchDetail = '无 patch';
if (fs.existsSync(patchPath)) {
  const text = fs.readFileSync(patchPath, 'utf8');
  if (!/-?\s*insert:/.test(text)) {
    console.error(`VERIFY-FAIL: ${name} cordis.patch.yml 无 insert 段`);
    process.exit(1);
  }
  const ids = [...text.matchAll(/^\s+-\s*id:\s*['"]?([^'"\n]+)['"]?\s*$/gm)].map((m) => m[1]);
  if (!ids.length) {
    console.error(`VERIFY-FAIL: ${name} cordis.patch.yml 无任何服务 id`);
    process.exit(1);
  }
  patchDetail = `services=${ids.join(',')}`;
}

console.log(`verify ok: ${name}（bundles=${inBundles} cordis=${inCordis}，${patchDetail}）`);
process.exit(0);
