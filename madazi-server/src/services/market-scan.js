import fs from 'fs';
import path from 'path';

/**
 * 模板市场 · 发布前密钥扫描（doc/2026-08-23-模板市场设计.md §五）
 *
 * 两条规则族，命中即拒绝发布：
 * 1. 密钥文件：*.pem / *.key / SSH 私钥 / 云凭证 JSON 等（全项目树扫描）
 * 2. 内容 pattern：AWS / 阿里云 / 腾讯云 AK、PEM 私钥块、GitHub/GitLab/Slack Token、
 *    sk- API Key、带密码的数据库连接串（只扫进包的文本文件）
 *
 * 原则：「扫什么 = 发什么」——内容扫描与打包共用同一套文件收集逻辑（collectPackageFiles）。
 * 注：.env / .env.* 不再按文件名拦截（前端项目常规配置，按用户要求放开）——
 * 它们随包分发并参与内容扫描，真密钥（AK/SK、sk-、带密码连接串等）仍会被内容规则拒绝。
 */

// ── 永不进包也永不扫描的目录（运行时 / 构建产物 / 第三方依赖） ──
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.dsh', 'dist', 'target', 'build', 'out',
  '.next', '.nuxt', '.output', 'coverage', '.pnpm-store', '.cache', '.npm-cache',
]);

// ── 默认发布排除（不进包）──
// 注：.env / .env.* 不再排除（前端项目常规配置，随包分发；内容扫描兜底真密钥）
const DEFAULT_PUBLISH_IGNORES = [
  '*.log', '.DS_Store', 'Thumbs.db', '.madaziignore',
];

// ── 密钥文件规则（按 basename 匹配）──
const SECRET_FILE_RULES = [
  {
    rule: 'cert-key-file',
    label: '证书 / 私钥文件',
    hint: '证书与私钥不应打进模板，请移出项目目录',
    test: (base) => /\.(pem|key|p12|pfx|jks|keystore)$/i.test(base),
  },
  {
    rule: 'ssh-key',
    label: 'SSH 私钥',
    hint: 'SSH 私钥不应打进模板，请移出项目目录',
    test: (base) => /^id_(rsa|dsa|ecdsa|ed25519)(\.\w+)?$/.test(base),
  },
  {
    rule: 'cloud-credentials-json',
    label: '云凭证 JSON',
    hint: '云服务凭证不应打进模板，请移出项目目录',
    test: (base) =>
      /^(credentials?|secrets?)\.json$/i.test(base) || /^service[-_]?account.+\.json$/i.test(base),
  },
  {
    rule: 'netrc',
    label: '.netrc 凭证文件',
    hint: 'netrc 含登录凭证，请移出项目目录',
    test: (base) => base === '.netrc' || base === '_netrc',
  },
];

// ── 内容 pattern 规则（高精度优先，避免误伤普通代码） ──
const CONTENT_RULES = [
  { rule: 'aws-access-key-id', label: 'AWS Access Key ID', re: /\bA(?:KIA|GPA|IDA|ROA|IPA|NPA|NVA|SIA)[A-Z0-9]{16}\b/g },
  { rule: 'aliyun-access-key-id', label: '阿里云 AccessKey ID', re: /\bLTAI[A-Za-z0-9]{12,22}\b/g },
  { rule: 'tencent-secret-id', label: '腾讯云 SecretId', re: /\bAKID[A-Za-z0-9]{13,40}\b/g },
  { rule: 'private-key-block', label: 'PEM 私钥内容', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g },
  { rule: 'github-token', label: 'GitHub Token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g },
  { rule: 'github-pat', label: 'GitHub 细粒度 PAT', re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { rule: 'gitlab-pat', label: 'GitLab Token', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { rule: 'slack-token', label: 'Slack Token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { rule: 'google-api-key', label: 'Google API Key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { rule: 'sk-api-key', label: 'sk- 开头的 API Key（OpenAI / DeepSeek 等）', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g },
  // 密码段允许含 @ 和 /（贪婪回溯到最后的 @，兼容 p@ssw0rd 这类密码）
  { rule: 'db-url-credentials', label: '带密码的数据库连接串', re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:'"@/]+:[^\s'"]{4,}@/g },
];

// 二进制扩展名（跳过内容扫描）
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.avif', '.tiff', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.webm', '.mov', '.avi', '.mkv',
  '.zip', '.gz', '.tar', '.tgz', '.rar', '.7z', '.jar', '.war',
  '.class', '.pyc', '.wasm', '.pdf',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.apk', '.ipa',
]);

const MAX_FINDINGS = 50; // 响应体积保护：最多报 50 条，多余的汇总

/** 简易 glob → RegExp（* = 非/任意段字符，? = 单字符；无目录语义魔法，够 .madaziignore 用） */
function globToRegExp(pattern) {
  let re = '';
  for (const ch of pattern) {
    if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

/** 读取项目根 .madaziignore（# 注释、每行一个 pattern） */
function readMadaziIgnore(projectDir) {
  const p = path.join(projectDir, '.madaziignore');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/** 判断相对路径是否命中一组 ignore 规则（basename 或相对路径任一匹配；! 前缀为反向豁免） */
function matchesIgnore(relPath, patterns) {
  const base = path.posix.basename(relPath);
  let ignored = false;
  for (const raw of patterns) {
    const negate = raw.startsWith('!');
    const pat = negate ? raw.slice(1) : raw;
    const re = globToRegExp(pat);
    if (re.test(base) || re.test(relPath) || relPath.startsWith(pat + '/')) {
      ignored = !negate;
    }
  }
  return ignored;
}

/** 递归收集文件（跳过 SKIP_DIRS），返回相对路径列表（posix 分隔符） */
function walkFiles(projectDir) {
  const out = [];
  const rec = (dir, base) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 不可读目录直接跳过
    }
    for (const e of entries) {
      const rel = base ? base + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        rec(path.join(dir, e.name), rel);
      } else if (e.isFile()) {
        out.push(rel);
      }
      // 符号链接：不收集（防链接逃逸，打包阶段同样不跟随）
    }
  };
  rec(projectDir, '');
  return out;
}

/** 掩码命中内容：只露前几位 + 长度，避免扫描结果本身泄露密钥 */
function maskMatch(s) {
  if (s.length <= 12) return s.slice(0, 4) + '…';
  return s.slice(0, 6) + '…(' + s.length + ' 字符)';
}

/** 是否为二进制文件（按扩展名 + 首块 null 字节嗅探） */
function isBinaryFile(fullPath, ext) {
  if (BINARY_EXTS.has(ext)) return true;
  const fd = fs.openSync(fullPath, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, 8192, 0);
    return buf.subarray(0, n).includes(0);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 收集进包文件清单（打包与内容扫描共用，保证「扫什么 = 发什么」）
 * @returns {string[]} 相对路径列表（已应用 DEFAULT_PUBLISH_IGNORES + .madaziignore）
 */
export function collectPackageFiles(projectDir) {
  const ignores = [...DEFAULT_PUBLISH_IGNORES, ...readMadaziIgnore(projectDir)];
  return walkFiles(projectDir).filter((rel) => !matchesIgnore(rel, ignores));
}

/**
 * 发布前密钥扫描
 * @param {string} projectDir 项目源码目录
 * @returns {{ ok: boolean, findings: Array, stats: object }}
 *   findings: { type: 'secret-file'|'secret-content', rule, label, hint?, file, line?, match?, detail }
 */
export function scanProjectForPublish(projectDir) {
  const findings = [];
  const addFinding = (f) => {
    if (findings.length < MAX_FINDINGS) findings.push(f);
  };

  if (!fs.existsSync(projectDir)) {
    return {
      ok: false,
      findings: [{ type: 'error', rule: 'missing-dir', label: '项目目录不存在', file: projectDir }],
      stats: { walkedFiles: 0, packageFiles: 0, scannedFiles: 0 },
    };
  }

  const allFiles = walkFiles(projectDir);

  // 1. 密钥文件检查：全量文件（证书/私钥/SSH/云凭证即使被 ignore 也拒绝，倒逼清理）
  for (const rel of allFiles) {
    const base = path.posix.basename(rel);
    for (const r of SECRET_FILE_RULES) {
      if (r.test(base)) {
        addFinding({
          type: 'secret-file', rule: r.rule, label: r.label, hint: r.hint, file: rel,
          detail: `文件名命中密钥文件规则（${base}）`,
        });
        break; // 一个文件只报第一条命中的规则
      }
    }
  }

  // 2. 内容 pattern 扫描：只扫进包文件中的文本文件
  const packageFiles = collectPackageFiles(projectDir);
  let scannedFiles = 0;
  for (const rel of packageFiles) {
    const full = path.join(projectDir, rel);
    const ext = path.posix.extname(rel).toLowerCase();
    let content;
    try {
      if (isBinaryFile(full, ext)) continue;
      content = fs.readFileSync(full, 'utf-8');
    } catch {
      continue; // 读失败按跳过处理（打包阶段自然会失败并报错）
    }
    scannedFiles++;
    for (const rule of CONTENT_RULES) {
      for (const m of content.matchAll(rule.re)) {
        const matched = m[0];
        const line = content.slice(0, m.index || 0).split('\n').length;
        addFinding({
          type: 'secret-content', rule: rule.rule, label: rule.label, file: rel, line,
          match: maskMatch(matched),
          hint: '请将密钥移到运行时环境变量 / 平台密钥管理中，示例值请改为明显占位符',
          detail: `${rel}:${line} 命中 ${rule.label}`,
        });
        if (findings.length >= MAX_FINDINGS) break;
      }
      if (findings.length >= MAX_FINDINGS) break;
    }
    if (findings.length >= MAX_FINDINGS) break;
  }

  const truncated = findings.length >= MAX_FINDINGS;
  return {
    ok: findings.length === 0,
    findings,
    truncated,
    stats: {
      walkedFiles: allFiles.length,
      packageFiles: packageFiles.length,
      scannedFiles,
    },
  };
}
