// 从 anthropics/skills 提取选定技能的 SKILL.md 正文（剥 frontmatter），生成市场发布 JSON
const fs = require("fs");
const path = require("path");

const ROOT = "/tmp/anthropics-skills/skills";

const SELECT = [
  { name: "技能创作器", dir: "skill-creator", category: "meta", icon: "wrench", color: "#8B5CF6", desc: "创建/修改/评估 Agent 技能（元技能）。" },
  { name: "MCP 服务构建", dir: "mcp-builder", category: "backend", icon: "plug", color: "#10B981", desc: "构建高质量 MCP Server（Python/TypeScript），集成外部 API。" },
  { name: "Web 应用测试", dir: "webapp-testing", category: "testing", icon: "bug", color: "#3B82F6", desc: "Playwright 测试本地 Web 应用：功能验证/调试/截图/日志。" },
  { name: "前端设计", dir: "frontend-design", category: "frontend", icon: "palette", color: "#EC4899", desc: "独特、有意图的前端视觉设计指导，避免模板化。" },
  { name: "内部沟通", dir: "internal-comms", category: "communication", icon: "megaphone", color: "#F59E0B", desc: "编写 3P 更新/周报/FAQ/公告等内部沟通文案，统一文风。" },
  { name: "文档共创", dir: "doc-coauthoring", category: "writing", icon: "edit", color: "#06B6D4", desc: "结构化共创文档：上下文收集→迭代打磨→读者验证。" },
];

function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: md.trim() };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1].trim()] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: m[2].trim() };
}

const out = [];
for (const s of SELECT) {
  const fp = path.join(ROOT, s.dir, "SKILL.md");
  const md = fs.readFileSync(fp, "utf8");
  const { meta, body } = parseFrontmatter(md);
  out.push({
    name: s.name,
    description: s.desc + "（原：anthropics/skills " + (meta.description || "").slice(0, 120) + "…）",
    icon: s.icon,
    color: s.color,
    category: s.category,
    prompt: body,
    source: "anthropics/skills",
  });
  console.log("parsed:", s.dir, "body", body.length, "chars, frontmatter name=" + meta.name);
}

fs.writeFileSync("/tmp/skills-payload.json", JSON.stringify(out, null, 2));
console.log("payload written:", out.length, "skills -> /tmp/skills-payload.json");
