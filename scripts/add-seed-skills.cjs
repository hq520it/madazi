// 从 skills-payload.json 读取并发布到技能市场（admin cookie 认证）
const fs = require("fs");
const BASE = "http://localhost:30456";
const JAR = "/tmp/madazi-cookie.txt";

// code-review 自写技能（基于 madazi 协同开发场景）
const codeReview = {
  name: "代码审查",
  description: "按团队规范审查代码：问题清单、修复建议、风险点。用于 PR/MR 提交前或代码评审时。",
  icon: "review", color: "#5E6AD2", category: "code-review",
  prompt: `## 角色
你是资深代码审查专家，站在代码作者和团队的立场做建设性评审。

## 输入
- 被审查的代码（diff 或文件）
- 若已知，附带项目技术栈 / 团队规范

## 审查维度
1. 正确性：逻辑 bug、边界条件、空值/异常处理
2. 安全性：注入、越权、敏感信息、路径穿越、命令注入
3. 性能：复杂度、不必要的循环、N+1 查询
4. 可维护性：命名、重复代码、抽象是否恰当、是否过度设计
5. 一致性：与项目现有模式/约定是否一致

## 输出格式
\`\`\`
## 审查结论
[通过 / 需要修改 / 严重问题]

## 问题清单（按严重度排序）
1. [严重] <位置> <问题描述>
2. [中等] <位置> <问题描述>
3. [建议] <位置> <问题描述>

## 修复建议
- 对每个严重/中等问题的具体修改方案

## 风险点
- 本次改动可能影响的范围、回归风险
\`\`\`

## 原则
- 就事论事，指出问题同时认可好的设计
- 每条意见给出依据，不空泛
- 区分"必须改"和"可选建议"
`,
};

async function login() {
  const r = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.token) throw new Error("login failed: " + JSON.stringify(j));
  return j.token;
}

async function publish(token, skill) {
  const r = await fetch(BASE + "/api/skills", {
    method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
    body: JSON.stringify({ name: skill.name, description: skill.description, icon: skill.icon, color: skill.color, category: skill.category, prompt: skill.prompt }),
  });
  const j = await r.json().catch(() => ({}));
  return { name: skill.name, ok: r.ok, id: j.id, error: j.error };
}

(async () => {
  const token = await login();
  const payload = JSON.parse(fs.readFileSync("/tmp/skills-payload.json", "utf8"));
  const all = payload.concat([codeReview]);
  for (const s of all) {
    const r = await publish(token, s);
    console.log(r.ok ? "✓ published " + r.name + " (" + r.id + ")" : "✗ FAIL " + r.name + ": " + r.error);
  }
})();
