// E2E 验证 P1 编辑器版本守卫（dsh-web 工作台 /git/fs/write CAS）
// 场景：
//   1) read 返回 version（dev:ino:size:mtimeNs:ctimeNs 格式）
//   2) 带正确 version 写入 → ok 且返回新 version（与旧不同）
//   3) 带过期 version 写入（模拟 AI/他人先改）→ FS_STALE_VERSION，内容未变
//   4) 不带 version 写入（旧客户端兼容）→ ok 盲写
//   5) 文件被删后带 version 写入 → FS_STALE_VERSION（不是重建）
const BASE = 'https://<YOUR-DOMAIN>';
const TOKEN = require('fs').readFileSync('/tmp/e2e_token', 'utf8').trim();

async function rpc(method, payload) {
  const r = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ type: 'client-request', rpcId: 'e2e-' + Math.random().toString(36).slice(2, 8), method, payload }),
  });
  return r.json();
}

// workbench 插件 host 路由（/git/*，cookie JWT 认证，经 server 反代 → dsh-web）
async function wbRead(workspaceId, path) {
  const q = new URLSearchParams({ workspaceId, path });
  const r = await fetch(`${BASE}/git/fs/read?${q}`, {
    headers: { Cookie: `madazi_token=${encodeURIComponent(TOKEN)}` },
  });
  return r.json();
}
async function wbWrite(workspaceId, path, content, expectedVersion) {
  const r = await fetch(`${BASE}/git/fs/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `madazi_token=${encodeURIComponent(TOKEN)}` },
    body: JSON.stringify(expectedVersion === undefined
      ? { workspaceId, path, content }
      : { workspaceId, path, content, expectedVersion }),
  });
  return r.json();
}
async function wbDelete(workspaceId, path) {
  const r = await fetch(`${BASE}/git/fs/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `madazi_token=${encodeURIComponent(TOKEN)}` },
    body: JSON.stringify({ workspaceId, path }),
  });
  return r.json();
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — ${detail}`); }
}

(async () => {
  // 0) token 有效性
  const me = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (me.status !== 200) { console.log('FAIL: token 失效，先重新登录'); process.exit(1); }
  console.log('token 有效');

  // 1) 建测试工作区（PVC 上 scratch 目录已由外部创建并写入 test.txt）
  const WS_PATH = '/app/generated/e2e-fsguard-test';
  const created = await rpc('workspace.create', { path: WS_PATH });
  const wsId = created.result?.value?.workspace?.workspaceId;
  if (!wsId) { console.log('FAIL: workspace.create:', JSON.stringify(created).slice(0, 300)); process.exit(1); }
  console.log('测试工作区:', wsId);
  const PATH = 'test.txt';

  // 2) read 返回 version
  const r1 = await wbRead(wsId, PATH);
  check('read 返回 version', typeof r1.value?.version === 'string' && r1.value.version.startsWith('dev:'), JSON.stringify(r1).slice(0, 200));
  const v1 = r1.value?.version;

  // 3) 带正确 version 写入 → ok + 新 version
  const w1 = await wbWrite(wsId, PATH, 'user-edit-1\n', v1);
  check('带正确 version 写入 ok', w1.ok === true && typeof w1.value?.version === 'string', JSON.stringify(w1).slice(0, 200));
  const v2 = w1.value?.version;
  check('写入后 version 变化', v2 !== v1 && typeof v2 === 'string', `v1=${v1} v2=${v2}`);

  // 4) 带过期 version 写入 → FS_STALE_VERSION（模拟：AI 先改了文件）
  const aiWrite = await wbWrite(wsId, PATH, 'ai-edit\n'); // AI 盲写（无版本）
  check('模拟 AI 改盘 ok', aiWrite.ok === true, JSON.stringify(aiWrite).slice(0, 200));
  const stale = await wbWrite(wsId, PATH, 'user-edit-2\n', v2);
  check('过期 version 写入被拒 FS_STALE_VERSION', stale.ok === false && stale.code === 'FS_STALE_VERSION', JSON.stringify(stale).slice(0, 300));
  const r2 = await wbRead(wsId, PATH);
  check('被拒后磁盘内容仍是 AI 版本', r2.value?.content === 'ai-edit\n', JSON.stringify(r2.value?.content));

  // 5) 不带 version 写入（旧客户端兼容）→ ok
  const legacy = await wbWrite(wsId, PATH, 'legacy-write\n');
  check('不带 version 盲写兼容 ok', legacy.ok === true, JSON.stringify(legacy).slice(0, 200));

  // 6) 文件被删后带 version 写入 → FS_STALE_VERSION（不是静默重建）
  const r3 = await wbRead(wsId, PATH);
  const v3 = r3.value?.version;
  const del = await wbDelete(wsId, PATH); // workbench 插件路由 /git/fs/delete
  if (del.ok === true) {
    const afterDel = await wbWrite(wsId, PATH, 'resurrect\n', v3);
    check('删文件后带 version 写入被拒', afterDel.ok === false && afterDel.code === 'FS_STALE_VERSION', JSON.stringify(afterDel).slice(0, 300));
  } else {
    console.log(`  ⚠ 场景6跳过（删除失败：${JSON.stringify(del).slice(0, 120)}）`);
  }

  // 7) 清理：删工作区记录
  const delWs = await rpc('workspace.delete', { workspaceId: wsId });
  console.log('清理工作区记录:', delWs.result?.ok === true ? 'ok' : JSON.stringify(delWs).slice(0, 150));

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})();
