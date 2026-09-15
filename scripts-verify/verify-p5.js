#!/usr/bin/env node
// P5 验证：模拟 login 插件的 per-user BYOK 注入 + 新会话绑创建者路由 + 记账归属
// 用法：node verify-p5.js <username> <password>
const BASE = "https://<YOUR-DOMAIN>";

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) throw new Error("usage: node verify-p5.js <username> <password>");

  // 1) 登录
  const login = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const { token } = await login.json();
  const user = (await (await fetch(BASE + "/api/auth/me", { headers: { cookie } })).json()).user;
  const uid = String(user.id || user.username).replace(/[^a-zA-Z0-9_]/g, "");
  const ROUTE = "madazi-u-" + uid, KEY_REF = "MADAZI_KEY_" + uid;
  console.log(`[1] 登录 ok: ${user.username} (${user.role}) route=${ROUTE}`);

  // 2) RPC helper（dsh /api/<method>，Bearer JWT）
  const rpc = async (method, payload) => {
    const r = await fetch(BASE + "/api/" + method, {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: JSON.stringify({ type: "client-request", rpcId: crypto.randomUUID(), method, payload })
    });
    if (!r.ok) throw new Error(`${method} HTTP ${r.status}`);
    return (await r.json()).result;
  };

  // 3) 幂等检查：自己的路由+key 是否已配置
  const desc = await rpc("settings.describe", {});
  const ns = desc.value.namespaces.find((x) => x.ns === "llm-pi-ai");
  const route = ns.value.providers[ROUTE];
  let view = null;
  if (route && route.apiKeyEnv === KEY_REF) {
    const cred = await rpc("credentials.describe", { refs: [KEY_REF] });
    view = cred.value.credentials[KEY_REF];
  }
  if (view && view.configured) {
    console.log(`[2] 幂等命中：路由+key 已配置（跳过注入）`);
  } else {
    // 4) 注入：provision + settings.mutate + credentials.set
    const kr = await fetch(BASE + "/api/keys/provision", {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "dsh-workbench" })
    });
    const kd = await kr.json();
    const models = (kd.models || []).map((m) => ({ id: m, name: m }));
    const profile = {
      apiKeyEnv: KEY_REF, displayName: "Madazi · " + user.username,
      api: "openai-completions", baseURL: BASE + "/llm/v1",
      models: models.length ? models : [{ id: "deepseek-chat", name: "deepseek-chat" }]
    };
    const mu = await rpc("settings.mutate", { ns: "llm-pi-ai", ops: [{ op: "set", path: ["providers", ROUTE], value: profile }], expectedRevision: ns.revision });
    if (!mu.ok) throw new Error("settings.mutate 失败: " + JSON.stringify(mu.error));
    const st = await rpc("credentials.set", { ref: KEY_REF, value: kd.key });
    if (!st.ok) throw new Error("credentials.set 失败: " + JSON.stringify(st.error));
    console.log(`[2] 注入 ok：路由 ${ROUTE} + ${models.length} 模型 + key ${kd.key_prefix}…`);
  }

  // 5) 验证路由共存（旧共享路由应仍在）
  const desc2 = await rpc("settings.describe", {});
  const providers = desc2.value.namespaces.find((x) => x.ns === "llm-pi-ai").value.providers;
  console.log(`[3] 当前 providers: ${Object.keys(providers).join(", ")}`);

  // 6) 找一个已有项目 workspace 建会话
  const ws = await rpc("workspace.list", {});
  const target = ws.value.items.find((w) => (w.title || "").includes("请假")) || ws.value.items[0];
  const created = await rpc("session.create", { workspaceId: target.workspaceId });
  if (!created.ok) throw new Error("session.create 失败: " + JSON.stringify(created.error));
  const sid = created.value.sessionId;
  console.log(`[4] 会话创建 ok: ${sid.slice(0, 13)}… @ workspace "${target.title}"`);

  // 7) 绑创建者路由（插件 bindNewSessionsToOwnRoute 的核心动作）
  const def = desc2.value.namespaces.find((x) => x.ns === "agent-default-model");
  const models5 = providers[ROUTE].models.map((m) => m.id);
  const model = def && def.value && models5.includes(def.value.model) ? def.value.model : models5[0];
  const sel = await rpc("session.selectModel", { sessionId: sid, provider: ROUTE, model });
  if (!sel.ok) throw new Error("session.selectModel 失败: " + JSON.stringify(sel.error));
  console.log(`[5] selectModel ok: ${ROUTE}/${model} -> ${JSON.stringify(sel.value.selected)}`);

  // 8) 发一条小消息产生真实 LLM 消耗
  const prompt = await rpc("session.prompt", { sessionId: sid, mode: "queue", content: [{ type: "text", text: "回复 ok 两个字即可，不要做任何其他事" }] });
  if (!prompt.ok) throw new Error("session.prompt 失败: " + JSON.stringify(prompt.error));
  console.log(`[6] prompt ok（stopReason=${JSON.stringify((prompt.value && prompt.value.stopReason) || prompt.value)}）`);

  // 9) 归档测试会话，避免污染侧边栏
  const arch = await rpc("workspace.archiveSession", { sessionId: sid });
  console.log(`[7] 归档测试会话: ${arch.ok ? "ok" : JSON.stringify(arch.error)}`);

  console.log(`DONE ${user.username} 路由=${ROUTE} 会话=${sid}`);
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
