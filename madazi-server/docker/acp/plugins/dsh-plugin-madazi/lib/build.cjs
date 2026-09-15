#!/usr/bin/env node
/**
 * 构建 dsh-plugin-madazi 前端入口（client.js）
 *
 * 原理：client.js 是 DSH ModuleLoader 的 factory 函数体（window.__ModuleLoader__.load）。
 * ModuleLoader 的 require 只认预注册的 npm 包名（react 等），不支持本地文件 require，
 * 故无法直接拆分成多文件 require。本脚本将 lib/src/*.js 按序拼接为单个 factory 体，
 * 外裹 ModuleLoader 包装，输出 lib/client.js。
 *
 * 用法：node lib/build.js
 * 约束：src/ 下文件名 `NN-*.js`（NN 为两位数字序号），按字典序拼接。
 */
const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "src");
const outFile = path.join(__dirname, "client.js");

const HEADER = `window.__ModuleLoader__.load({
\tid: "@madazi/dsh-plugin-madazi",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
`;

const FOOTER = `\t\tmodule.exports.inject = ["slots", "locale", "sessions", "workspaces", "remote", "inputTriggers"];
\t\treturn module.exports;
\t}
});
`;

const files = fs.readdirSync(srcDir)
    .filter(f => f.endsWith(".js"))
    .sort();

if (!files.length) {
    console.error("build: no source files in " + srcDir);
    process.exit(1);
}

const parts = files.map(f => {
    const content = fs.readFileSync(path.join(srcDir, f), "utf8");
    // 统一换行结尾
    return "// ═══════════════════════════════════════════════════════════════\n// src/" + f + "\n// ═══════════════════════════════════════════════════════════════\n" + content.replace(/\s+$/, "");
});

const output = HEADER + parts.join("\n\n") + "\n" + FOOTER;

fs.writeFileSync(outFile, output);
console.log("build: " + files.length + " files -> " + outFile + " (" + output.length + " bytes)");
