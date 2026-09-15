window.__ModuleLoader__.load({
	id: "@madazi/dsh-plugin-madazi",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
// ═══════════════════════════════════════════════════════════════
// src/00-setup.js
// ═══════════════════════════════════════════════════════════════
		window.__madaziFactory = (window.__madaziFactory || 0) + 1;
		const react = require("react");
		const h = react.createElement;
		const { useEffect, useState, useRef } = react;
		// createRoot（React 18+）：常驻发布向导宿主用（react-dom/client 在壳的 module seed 表里）
		let reactDomClient = null;
		try { reactDomClient = require("react-dom/client"); } catch (e) { reactDomClient = null; }
		// 官方 UI primitives：UI 统一铁律——插件界面一律复用 dsh 工作台组件
		// （Modal/Button/Input/Menu + --dsw-alias-* token），不自绘独有控件。
		const prim = require("@deepseek-ai/dsh-client-ui-primitives");
		const { Modal, Button, Input, Menu, IconChevronDownOutline14, IconProjectAddOutline16 } = prim;

// ═══════════════════════════════════════════════════════════════
// src/01-css.js
// ═══════════════════════════════════════════════════════════════
// CSS injection (same pattern as official dsh-client-ui-* plugins)
// ★ 2026-09-03 全量 token 化：交互组件颜色全部收敛为 dsh 语义 token（--dsw-alias-*），
//   与 dsh 原生 UI 同源，深浅主题自动跟随。品牌金仅保留在 logo 文字（--dsw-alias-brand-primary）。
const css = `
.madazi-hello{box-sizing:border-box;margin:8px 16px;padding:12px 16px;border:1px dashed var(--dsw-alias-accent-primary,#4c8ffd);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 8%,transparent);color:var(--dsw-alias-label-primary,#0f1115);font-size:13px;line-height:20px}
.madazi-hello .t{font-weight:600;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center}
.madazi-hello .d{color:var(--dsw-alias-label-secondary,#61666b)}
.madazi-hello .p{display:flex;justify-content:space-between;gap:12px;padding:6px 8px;margin-top:6px;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 6%,transparent)}
.madazi-hello .pn{font-weight:500;color:var(--dsw-alias-label-primary,#0f1115)}
.madazi-hello .pd{color:var(--dsw-alias-label-secondary,#61666b);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:45%}
.madazi-hello .badge{font-size:11px;padding:1px 8px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 15%,transparent);color:var(--dsw-alias-accent-primary,#4c8ffd)}
.madazi-taskbtn{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;font-size:12px;line-height:20px;border:1px solid color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 40%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 8%,transparent);color:var(--dsw-alias-label-primary,#0f1115);cursor:pointer;white-space:nowrap}
.madazi-taskbtn:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}
.madazi-badge{min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-accent-primary,#4c8ffd);color:var(--dsw-alias-label-primary-foreground,#fff);font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}
.madazi-pop{position:absolute;top:calc(100% + 8px);right:0;z-index:999;width:340px;max-height:380px;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));border-radius:10px;background:var(--dsw-alias-bg-base,#1c1c1e);box-shadow:0 8px 28px rgba(0,0,0,.4);overflow:hidden}
.madazi-pop-hd{padding:8px 12px;font-size:12px;font-weight:600;border-bottom:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));display:flex;justify-content:space-between;align-items:center}
.madazi-pop-d{padding:12px;font-size:12px;color:var(--dsw-alias-label-secondary,#61666b)}
.madazi-pop-l{overflow-y:auto;padding:4px 0}
.madazi-task{padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));font-size:12px}
.madazi-task-t{display:flex;justify-content:space-between;gap:8px;align-items:center}
.madazi-task-msg{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#0f1115)}
.madazi-task-st{flex-shrink:0;font-size:11px;padding:1px 6px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-secondary,#61666b) 18%,transparent);color:var(--dsw-alias-label-secondary,#61666b)}
.madazi-task-st.running{background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 15%,transparent);color:var(--dsw-alias-accent-primary,#4c8ffd)}
.madazi-task-st.success{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#34C759) 15%,transparent);color:var(--dsw-alias-state-success-primary,#34C759)}
.madazi-task-st.failed,.madazi-task-st.cancelled{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#FF453A) 15%,transparent);color:var(--dsw-alias-state-error-primary,#FF453A)}
.madazi-task-d{color:var(--dsw-alias-label-tertiary,#81858c);font-size:11px;margin-top:3px}
.madazi-footer-entry{display:flex;align-items:center}
.madazi-footer-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:36px;padding:4px 10px;font-size:12px;line-height:20px;border:1px solid color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 40%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 8%,transparent);color:var(--dsw-alias-label-primary,#0f1115);cursor:pointer;white-space:nowrap}
.madazi-footer-btn:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}
.madazi-proj-pop{left:0;right:auto;width:320px}
.madazi-proj{display:block;width:calc(100% - 16px);margin:3px 8px;padding:8px 12px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#0f1115);text-align:left;cursor:pointer;font-size:12px}
.madazi-proj:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}
.madazi-proj-n{display:block;font-weight:600}
.madazi-proj-d{display:block;color:var(--dsw-alias-label-secondary,#61666b);font-size:11px}
.madazi-flow-overlay{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center}
.madazi-flow-dialog{width:400px;max-width:calc(100vw - 32px);max-height:70vh;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));border-radius:12px;background:var(--dsw-alias-bg-base,#1c1c1e);box-shadow:0 12px 40px rgba(0,0,0,.5);overflow:hidden}
.madazi-proj:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06));border-color:var(--dsw-alias-border-l2, rgba(0,0,0,.14))}
.madazi-proj:disabled{opacity:.6;cursor:wait}
.madazi-proj-n{display:block;font-weight:600;color:var(--dsw-alias-label-primary,#0f1115)}
.madazi-proj-d{display:block;margin-top:2px;color:var(--dsw-alias-label-tertiary,#81858c);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.madazi-settings{display:flex;flex-direction:column;gap:12px;width:100%;min-width:320px}
.madazi-settings-hd{display:flex;justify-content:space-between;align-items:flex-start}
.madazi-settings-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#0f1115)}
.madazi-settings-sub{font-size:12px;color:var(--dsw-alias-label-secondary,#61666b);margin-top:2px}
.madazi-settings-refresh{padding:4px 12px;font-size:12px;border:1px solid color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 40%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 8%,transparent);color:var(--dsw-alias-label-primary,#0f1115);cursor:pointer}
.madazi-settings-refresh:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}
.madazi-settings-list{display:flex;flex-direction:column;gap:8px}
.madazi-settings-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));border-radius:8px;background:var(--dsw-alias-bg-base,transparent)}
.madazi-settings-row-main{min-width:0}
.madazi-settings-row-n{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary,#0f1115)}
.madazi-settings-row-d{font-size:12px;color:var(--dsw-alias-label-secondary,#61666b);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}
.madazi-settings-open{padding:3px 10px;font-size:12px;border:1px solid color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 40%,transparent);border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 8%,transparent);color:var(--dsw-alias-accent-primary,#4c8ffd);cursor:pointer;white-space:nowrap}
.madazi-settings-open:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}
.madazi-settings-open:disabled{opacity:.5;cursor:default}
.madazi-form{display:flex;flex-direction:column;gap:8px;padding:12px}
.madazi-form label{font-size:11px;color:var(--dsw-alias-label-secondary,#61666b)}
.madazi-inp{width:100%;box-sizing:border-box;padding:6px 10px;font-size:13px;border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));border-radius:8px;background:var(--dsw-alias-bg-base,#232326);color:var(--dsw-alias-label-primary,#0f1115);outline:none}
.madazi-inp:focus{border-color:var(--dsw-alias-accent-primary,#4c8ffd)}
.madazi-sel{width:100%;box-sizing:border-box;padding:6px 10px;font-size:13px;border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));border-radius:8px;background:var(--dsw-alias-bg-base,#232326);color:var(--dsw-alias-label-primary,#0f1115);outline:none;color-scheme:dark}
.madazi-sel option{background:var(--dsw-alias-bg-base,#232326);color:var(--dsw-alias-label-primary,#0f1115)}
.madazi-sel:focus{border-color:var(--dsw-alias-accent-primary,#4c8ffd)}
.madazi-btn-pri{display:inline-flex;align-items:center;justify-content:center;padding:6px 12px;font-size:13px;font-weight:600;border:none;border-radius:8px;background:var(--dsw-alias-accent-primary,#4c8ffd);color:var(--dsw-alias-label-primary-foreground,#fff);cursor:pointer}
.madazi-btn-pri:hover{background:var(--dsw-alias-interactive-bg-hover-solid,#3a78d8)}
.madazi-btn-pri:disabled{opacity:.55;cursor:default}
.madazi-btn-ghost{display:inline-flex;align-items:center;justify-content:center;padding:5px 10px;font-size:12px;border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#0f1115);cursor:pointer}
.madazi-btn-ghost:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}
.madazi-btn-ghost:disabled{opacity:.5;cursor:default}
.madazi-btn-danger{display:inline-flex;align-items:center;justify-content:center;padding:3px 8px;font-size:11px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#FF453A) 50%,transparent);border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#FF453A) 10%,transparent);color:var(--dsw-alias-state-error-primary,#FF453A);cursor:pointer}
.madazi-btn-danger:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#FF453A) 20%,transparent)}
.madazi-kv{display:flex;justify-content:space-between;gap:12px;padding:6px 0;font-size:12px}
.madazi-kv .k{color:var(--dsw-alias-label-secondary,#61666b)}
.madazi-kv .v{color:var(--dsw-alias-label-primary,#0f1115);font-weight:500}
.madazi-key-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));font-size:12px}
.madazi-key-prefix{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-primary,#0f1115)}
.madazi-key-st{font-size:11px;padding:1px 8px;border-radius:999px}
.madazi-key-st.active{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#34C759) 15%,transparent);color:var(--dsw-alias-state-success-primary,#34C759)}
.madazi-key-st.revoked{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#FF453A) 15%,transparent);color:var(--dsw-alias-state-error-primary,#FF453A)}
.madazi-sec-hd{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#0f1115);border-bottom:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));cursor:pointer}
.madazi-sec-hd:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}
.madazi-sec-bd{padding:8px 12px;display:flex;flex-direction:column;gap:6px}
.madazi-newbtn{align-self:flex-start;margin:8px 12px 0;padding:4px 10px;font-size:12px;border:1px solid color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 40%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 8%,transparent);color:var(--dsw-alias-accent-primary,#4c8ffd);cursor:pointer;white-space:nowrap}
.madazi-newbtn:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}
.madazi-create-err{font-size:11px;color:var(--dsw-alias-state-error-primary,#FF453A);padding:0 12px 6px}
.madazi-role-badge{font-size:10px;padding:1px 7px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 15%,transparent);color:var(--dsw-alias-accent-primary,#4c8ffd)}
.madazi-user-row,.madazi-admin-user-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));font-size:12px}
.madazi-user-row .un,.madazi-admin-user-row .un{font-weight:500;color:var(--dsw-alias-label-primary,#0f1115)}
.madazi-user-row .meta,.madazi-admin-user-row .meta{font-size:11px;color:var(--dsw-alias-label-tertiary,#81858c)}
.madazi-empty{color:var(--dsw-alias-label-tertiary,#81858c);font-size:12px;padding:10px 12px}
.madazi-tpl-d{font-size:11px;color:var(--dsw-alias-label-tertiary,#81858c);margin-top:2px}
.madazi-online{font-size:11px;color:var(--dsw-alias-label-tertiary,#81858c);white-space:nowrap}
.madazi-online.on{color:var(--dsw-alias-state-success-primary,#34C759)}
.madazi-dot{font-size:9px;color:var(--dsw-alias-label-tertiary,#81858c)}
.madazi-dot.on{color:var(--dsw-alias-state-success-primary,#34C759)}
.madazi-prev-status{font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary,#81858c);margin:6px 0}
.madazi-prev-status.on{color:var(--dsw-alias-state-success-primary,#34C759)}
.madazi-prev-acts{display:flex;gap:6px;margin-top:4px}
.madazi-pop-btn{flex:1;padding:5px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));background:transparent;color:var(--dsw-alias-label-primary,#0f1115);font-size:12px;cursor:pointer}
.madazi-pop-btn:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}
.madazi-pop-btn.primary{background:var(--dsw-alias-accent-primary,#4c8ffd);border-color:var(--dsw-alias-accent-primary,#4c8ffd);color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:600}
.madazi-pop-btn.danger{color:var(--dsw-alias-state-error-primary,#FF453A);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#FF453A) 40%,transparent)}
.madazi-badge.on{background:var(--dsw-alias-state-success-primary,#34C759)}
.madazi-err{color:var(--dsw-alias-state-error-primary,#FF453A);font-size:11px;margin-bottom:6px}
.madazi-prevpop{width:380px}
.madazi-prev-url{display:flex;align-items:center;gap:6px;margin-top:6px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));border-radius:6px;background:var(--dsw-alias-bg-base,rgba(30,30,34,.03));font-size:11px}
.madazi-prev-url-lbl{color:var(--dsw-alias-label-tertiary,#81858c);flex:0 0 auto}
.madazi-prev-url code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#0f1115);font-family:ui-monospace,Menlo,monospace}
.madazi-prev-frame{width:100%;height:400px;border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));border-radius:8px;background:#fff;margin-top:8px;display:block}
.madazi-menu{position:absolute;top:calc(100% + 4px);right:0;z-index:30;min-width:150px;background:var(--dsw-alias-bg-base,rgba(30,30,34,.98));border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.4);padding:4px}
.madazi-menu-item{padding:7px 12px;font-size:12.5px;color:var(--dsw-alias-label-primary,#0f1115);border-radius:6px;cursor:pointer;white-space:nowrap}
.madazi-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}
.madazi-online-line{font-size:11px;color:var(--dsw-alias-label-tertiary,#81858c);margin-top:3px}
.madazi-online-line.on{color:var(--dsw-alias-state-success-primary,#34C759)}
/* 成员区（工作台统一风格：透明底、设计 token、头像同 madazi-web hash 配色） */
.madazi-ws-subrow{display:flex;align-items:center;gap:10px;padding:2px 12px 6px 34px;flex-wrap:wrap;min-width:0;flex-basis:100%;width:100%;box-sizing:border-box}
.madazi-ws-subrow .madazi-ws-loading{color:var(--dsw-alias-label-tertiary,#81858c);font-size:11px}
.madazi-ws-owner{display:inline-flex;align-items:center;gap:6px;min-width:0}
.madazi-ws-avatar{width:16px;height:16px;border-radius:50%;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;flex:none;position:relative}
.madazi-ws-owner-name{font-size:11px;color:var(--dsw-alias-label-secondary,#61666b);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:90px}
.madazi-ws-mavatar{width:16px;height:16px;border-radius:50%;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;flex:none;position:relative;box-shadow:0 0 0 1.5px var(--dsw-alias-bg-base,#1c1c1e)}
.madazi-ws-more{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}
.madazi-ws-avatars{display:inline-flex;align-items:center;gap:4px;min-width:0;flex-wrap:wrap;margin-left:auto}
.madazi-ws-online{position:relative}
.madazi-ws-online::after{content:'';position:absolute;right:-1px;bottom:-1px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#34C759);box-shadow:0 0 0 1.5px var(--dsw-alias-bg-base,#1c1c1e)}
.madazi-ws-add{width:16px;height:16px;border-radius:50%;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.14));background:transparent;color:var(--dsw-alias-label-secondary,#61666b);font-size:11px;line-height:1;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none;padding:0;box-sizing:border-box}
.madazi-ws-add:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#0f1115)}
/* 任务行创建人 chip（工作台 token： tertiary 文字 + hash 头像） */
.madazi-row-owner{display:inline-flex;align-items:center;gap:4px;flex:none;max-width:110px;vertical-align:middle}
.madazi-row-owner i{width:14px;height:14px;border-radius:50%;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:600;font-style:normal;flex:none}
.madazi-row-owner b{font-size:10px;font-weight:500;color:var(--dsw-alias-label-tertiary,#81858c);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 对话气泡发送人署名（user 气泡右对齐，署名随气泡靠右） */
.madazi-sender{display:flex;align-items:center;gap:6px;margin:10px 12px 3px 0;font-size:11px;color:var(--dsw-alias-label-secondary,#61666b);justify-content:flex-end}
.madazi-sender i{width:16px;height:16px;border-radius:50%;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;font-style:normal;flex:none}
.madazi-sender span{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 会话排序：groupSection 转 flex 列，行用 order 排布（纯显示层，不与 React 抢 DOM） */
.madazi-sort-flex{display:flex;flex-direction:column}
.madazi-members-overlay{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center}
.madazi-members-dialog{width:380px;max-width:calc(100vw - 32px);max-height:72vh;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));border-radius:12px;background:var(--dsw-alias-bg-base,#1c1c1e);box-shadow:0 12px 40px rgba(0,0,0,.5);overflow:hidden}
.madazi-members-hd{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#0f1115);border-bottom:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))}
.madazi-members-close{background:transparent;border:none;color:var(--dsw-alias-label-secondary,#61666b);font-size:14px;cursor:pointer;padding:2px 6px}
.madazi-members-close:hover{color:var(--dsw-alias-label-primary,#0f1115)}
.madazi-members-body{overflow-y:auto;flex:1;min-height:120px}
.madazi-members-load{padding:14px;font-size:12px;color:var(--dsw-alias-label-tertiary,#81858c)}
.madazi-members-foot{border-top:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));padding:8px 12px;display:flex;flex-direction:column;gap:6px}
.madazi-members-q{width:100%;box-sizing:border-box;padding:6px 10px;font-size:12px;border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));border-radius:8px;background:var(--dsw-alias-bg-base,#232326);color:var(--dsw-alias-label-primary,#0f1115);outline:none}
.madazi-members-q:focus{border-color:var(--dsw-alias-accent-primary,#4c8ffd)}
.madazi-members-results{max-height:150px;overflow-y:auto}
/* 分享技能到市场（/分享技能 浮层） */
.madazi-share-overlay{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center}
.madazi-share-dialog{width:460px;max-width:calc(100vw - 32px);max-height:72vh;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));border-radius:12px;background:var(--dsw-alias-bg-base,#1c1c1e);box-shadow:0 12px 40px rgba(0,0,0,.5);overflow:hidden}
.madazi-share-hd{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#0f1115);border-bottom:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))}
.madazi-share-title{font-size:13px;font-weight:600}
.madazi-share-body{overflow-y:auto;flex:1;min-height:120px;display:flex;flex-direction:column;gap:8px;padding:10px 12px}
.madazi-share-row{border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:6px}
.madazi-share-row-main{display:flex;flex-direction:column;gap:2px;min-width:0}
.madazi-share-form{display:flex;flex-direction:column;gap:6px;border-top:1px dashed var(--dsw-alias-border-l2, rgba(0,0,0,.14));padding-top:8px}
.madazi-share-acts{display:flex;gap:8px;justify-content:flex-end}
.madazi-share-foot{border-top:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));padding:8px 12px;font-size:12px;min-height:18px}
/* 技能市场浮层（/ 面板头部入口） */
.madazi-mkt-overlay{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center}
.madazi-mkt-dialog{width:640px;max-width:calc(100vw - 32px);max-height:80vh;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));border-radius:12px;background:var(--dsw-alias-bg-base,#1c1c1e);box-shadow:0 12px 40px rgba(0,0,0,.5);overflow:hidden}
.madazi-mkt-hd{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#0f1115);border-bottom:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))}
.madazi-mkt-title{font-size:13px;font-weight:600}
.madazi-mkt-body{overflow-y:auto;flex:1;min-height:120px;display:flex;flex-direction:column;gap:8px;padding:10px 14px}
.madazi-mkt-acts{display:flex;gap:8px;justify-content:flex-end}
.madazi-mkt-msg{border-top:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));padding:8px 14px;font-size:12px;min-height:18px}
/* / 面板头部固定入口 */
.madazi-slash-hd{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));background:var(--dsw-alias-bg-base,#1c1c1e);position:sticky;top:0;z-index:1}
.madazi-slash-mkt-btn{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#0f1115);background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 12%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 35%,transparent);border-radius:8px;padding:4px 10px;cursor:pointer;transition:background .12s}
.madazi-slash-mkt-btn:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}
.madazi-slash-mkt-hint{font-size:11px;color:var(--dsw-alias-label-tertiary,#81858c)}
/* madazi 定制：隐藏顶部「新建会话」按钮（新建任务入口=项目行右侧 +） */
.hHd-Xa_newSession{display:none !important}
/* madazi 定制：隐藏视图切换（分组/排序菜单），仅保留搜索与添加项目；宽栏下 headerActions 首子元素=ViewOptionsMenu（收起栏首子元素是添加按钮，勿动） */
.qDHVXG_root:not(.qDHVXG_rail) .qDHVXG_headerActions>:first-child{display:none !important}
/* M2 模板市场（madazi-mkt-*）：卡片/详情/chips/评分，全量 --dsw-alias token */
.madazi-mkt-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.madazi-mkt-search{flex:1;min-width:160px;box-sizing:border-box;padding:6px 10px;font-size:12px;border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));border-radius:8px;background:var(--dsw-alias-bg-base,#232326);color:var(--dsw-alias-label-primary,#0f1115);outline:none}
.madazi-mkt-search:focus{border-color:var(--dsw-alias-accent-primary,#4c8ffd)}
.madazi-mkt-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.madazi-mkt-chip{padding:3px 12px;font-size:12px;line-height:18px;border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#61666b);cursor:pointer;white-space:nowrap}
.madazi-mkt-chip:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}
.madazi-mkt-chip.on{background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 14%,transparent);border-color:var(--dsw-alias-accent-primary,#4c8ffd);color:var(--dsw-alias-accent-primary,#4c8ffd)}
.madazi-mkt-list{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.madazi-mkt-card{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));border-radius:10px;background:var(--dsw-alias-bg-base,transparent);cursor:pointer;text-align:left;width:100%;box-sizing:border-box}
.madazi-mkt-card:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06));border-color:var(--dsw-alias-border-l2, rgba(0,0,0,.14))}
.madazi-mkt-card-hd{display:flex;align-items:center;gap:8px;min-width:0}
.madazi-mkt-icon{flex:none;width:28px;height:28px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 12%,transparent);color:var(--dsw-alias-accent-primary,#4c8ffd);font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}
.madazi-mkt-name{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#0f1115);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.madazi-mkt-badge{flex:none;font-size:10px;padding:1px 7px;border-radius:999px;white-space:nowrap}
.madazi-mkt-badge.official{background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 15%,transparent);color:var(--dsw-alias-accent-primary,#4c8ffd)}
.madazi-mkt-badge.community{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06));color:var(--dsw-alias-label-secondary,#61666b)}
.madazi-mkt-badge.private{border:1px dashed var(--dsw-alias-border-l2, rgba(0,0,0,.14));color:var(--dsw-alias-label-tertiary,#81858c)}
.madazi-mkt-badge.pending{background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#FF9F0A) 15%,transparent);color:var(--dsw-alias-state-warning-primary,#FF9F0A)}
.madazi-mkt-badge.builtin{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#34C759) 15%,transparent);color:var(--dsw-alias-state-success-primary,#34C759)}
.madazi-mkt-builtin-tip{padding:10px 12px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#34C759) 8%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary,#34C759) 25%,transparent);font-size:12px;color:var(--dsw-alias-state-success-primary,#34C759);line-height:1.6}
.madazi-mkt-desc{font-size:11px;color:var(--dsw-alias-label-secondary,#61666b);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.madazi-mkt-tags{display:flex;gap:4px;flex-wrap:wrap}
.madazi-mkt-tags span{font-size:10px;color:var(--dsw-alias-label-tertiary,#81858c);background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06));border-radius:999px;padding:1px 8px}
.madazi-mkt-meta{font-size:11px;color:var(--dsw-alias-label-tertiary,#81858c);display:flex;gap:10px;flex-wrap:wrap}
.madazi-mkt-readme{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary,#61666b);white-space:pre-wrap;word-break:break-word;max-height:300px;overflow-y:auto;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));border-radius:8px;background:var(--dsw-alias-bg-base,#232326)}
.madazi-mkt-vers{display:flex;flex-direction:column;gap:4px;margin-top:6px}
.madazi-mkt-ver{display:flex;justify-content:space-between;gap:8px;font-size:11px;padding:5px 8px;border-radius:6px;background:var(--dsw-alias-bg-base,#232326)}
.madazi-mkt-ver .v{font-weight:600;color:var(--dsw-alias-label-primary,#0f1115)}
.madazi-mkt-ver .c{color:var(--dsw-alias-label-tertiary,#81858c);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.madazi-mkt-stars{display:flex;gap:2px;cursor:pointer}
.madazi-mkt-star{font-size:15px;color:var(--dsw-alias-label-tertiary,#81858c);line-height:1;cursor:pointer;padding:0 1px}
.madazi-mkt-star.on{color:var(--dsw-alias-state-warning-primary,#FF9F0A)}
.madazi-mkt-rate-ok{font-size:11px;color:var(--dsw-alias-state-success-primary,#34C759);margin-top:4px}
.madazi-mkt-install-row{display:flex;gap:8px;align-items:center}
.madazi-mkt-install-row .madazi-inp{flex:1}
.madazi-mkt-sort{flex:none;padding:5px 8px;font-size:12px;border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));border-radius:8px;background:var(--dsw-alias-bg-base,#232326);color:var(--dsw-alias-label-primary,#0f1115);outline:none;color-scheme:dark}
.madazi-mkt-sort option{background:var(--dsw-alias-bg-base,#232326);color:var(--dsw-alias-label-primary,#0f1115)}
button.madazi-mkt-ver{font-family:inherit;text-align:left;cursor:pointer;border:1px solid transparent}
.madazi-mkt-ver.on{border-color:var(--dsw-alias-accent-primary,#4c8ffd);background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 8%,transparent)}
/* M3 发布向导 */
.madazi-pub-form{display:flex;flex-direction:column;gap:10px}
.madazi-pub-form label{font-size:12px;color:var(--dsw-alias-label-secondary,#61666b)}
.madazi-pub-hint{font-size:11px;color:var(--dsw-alias-label-tertiary,#81858c);line-height:1.5}
.madazi-mkt-findings{margin-top:8px;display:flex;flex-direction:column;gap:4px;max-height:180px;overflow-y:auto}
.madazi-mkt-finding{font-size:11px;padding:5px 8px;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#FF453A) 8%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#FF453A) 20%,transparent)}
.madazi-mkt-finding .fl{color:var(--dsw-alias-state-warning-primary,#FF9F0A);font-weight:600}
.madazi-mkt-finding .ff{color:var(--dsw-alias-label-secondary,#61666b);word-break:break-all}
.madazi-mkt-ok{padding:10px 12px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#34C759) 8%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary,#34C759) 25%,transparent);display:flex;flex-direction:column;gap:4px;font-size:12px}
.madazi-mkt-ok .t{color:var(--dsw-alias-state-success-primary,#34C759);font-weight:600;font-size:13px}
/* 创建方式选择（添加项目首页）：三大方式卡片，点击进入对应流程 */
.madazi-way{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;width:100%}
.madazi-way-card{display:flex;flex-direction:column;gap:8px;padding:18px 16px;border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));border-radius:12px;background:var(--dsw-alias-bg-base,transparent);cursor:pointer;text-align:left;font-family:inherit;transition:border-color .15s,background .15s}
.madazi-way-card:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06));border-color:var(--dsw-alias-border-l2, rgba(0,0,0,.14))}
.madazi-way-ico{width:38px;height:38px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-size:17px;background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 12%,transparent);color:var(--dsw-alias-accent-primary,#4c8ffd)}
.madazi-way-t{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#0f1115);display:flex;align-items:center;gap:6px}
.madazi-way-tag{font-size:10px;padding:1px 7px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 15%,transparent);color:var(--dsw-alias-accent-primary,#4c8ffd);font-weight:500}
.madazi-way-d{font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-secondary,#61666b)}
.madazi-way-go{margin-top:auto;font-size:11px;color:var(--dsw-alias-accent-primary,#4c8ffd);display:flex;align-items:center;gap:4px}
/* 底部次级方式卡片（Git/本地）：两列紧凑版 */
.madazi-way-sub{grid-template-columns:1fr 1fr;gap:8px;border-top:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));padding-top:12px}
.madazi-way-sub .madazi-way-card{flex-direction:row;align-items:center;gap:10px;padding:10px 14px;flex-wrap:wrap}
.madazi-way-sub .madazi-way-t{font-size:12.5px}
.madazi-way-sub .madazi-way-d{font-size:11px}
/* 快速创建（添加项目默认视图）：官方模板卡片网格 + 次级入口 */
.madazi-quick{display:flex;flex-direction:column;gap:12px;width:100%;max-height:64vh;overflow-y:auto}
.madazi-quick-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.madazi-quick-card{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));border-radius:10px;background:var(--dsw-alias-bg-base,transparent);cursor:pointer;text-align:left;font-family:inherit}
.madazi-quick-card:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06));border-color:var(--dsw-alias-border-l2, rgba(0,0,0,.14))}
.madazi-quick-card.on{border-color:var(--dsw-alias-accent-primary,#4c8ffd);background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 8%,transparent)}
.madazi-quick-card-hd{display:flex;align-items:center;gap:8px;min-width:0}
.madazi-quick-card-tech{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#0f1115);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.madazi-quick-card-desc{font-size:11px;color:var(--dsw-alias-label-secondary,#61666b);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.madazi-quick-more{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;border-top:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));padding-top:12px}
.madazi-quick-more-btn{padding:4px 14px;font-size:12px;border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#61666b);cursor:pointer;font-family:inherit}
.madazi-quick-more-btn:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#0f1115)}
/* Modal 内容滚动约束（模板市场等长内容弹窗：宽度由 _dialog_ 覆盖规则控制，限高内滚） */
.madazi-flow-modal-body{width:100%;max-height:64vh;overflow-y:auto}
/* 项目行（侧栏项目弹窗）：主按钮 + ⋯ 菜单 */
.madazi-proj-row{display:flex;align-items:center;gap:2px;margin:3px 8px;position:relative;border-radius:8px}
.madazi-proj-row .madazi-proj{flex:1;margin:0;width:auto}
.madazi-proj-more{flex:none;width:26px;height:26px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,#81858c);font-size:14px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.madazi-proj-more:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#0f1115)}
/* ★ 官方 Modal primitive 的 _dialog_ CSS-modules 类固定 ~380px，会压住宽内容。 :has() 精确定位「含市场/快速创建内容」的弹窗撑宽（hash 后缀随构建变，故用 class*= 前缀匹配） */
[class*='_dialog_']:has(.madazi-way),[class*='_dialog_']:has(.madazi-quick){width:min(960px,calc(100vw - 48px))!important}
[class*='_dialog_']:has(.madazi-flow-modal-body){width:min(840px,calc(100vw - 48px))!important}
[class*='_dialog_']:has(.madazi-way) [class*='_content_'],[class*='_dialog_']:has(.madazi-way) [class*='_body_'],[class*='_dialog_']:has(.madazi-quick) [class*='_content_'],[class*='_dialog_']:has(.madazi-quick) [class*='_body_'],[class*='_dialog_']:has(.madazi-flow-modal-body) [class*='_content_'],[class*='_dialog_']:has(.madazi-flow-modal-body) [class*='_body_']{width:100%!important;max-width:100%!important;box-sizing:border-box!important}
/* 预览日志面板（madazi-logs）：错误行标红 + 行尾 AI 修复 chip（hover 显现） */
.madazi-loghd{display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:11px;color:var(--dsw-alias-label-tertiary,#81858c);cursor:pointer;user-select:none}
.madazi-loghd:hover{color:var(--dsw-alias-label-secondary,#61666b)}
.madazi-logs{margin-top:4px;border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));border-radius:8px;background:var(--dsw-alias-bg-base,#0d0d0f);max-height:180px;overflow-y:auto;padding:6px 8px;font-family:ui-monospace,Menlo,monospace;font-size:10.5px;line-height:1.5}
.madazi-logline{display:flex;gap:6px;align-items:baseline}
.madazi-logline .lt{flex:1;min-width:0;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-secondary,#61666b)}
.madazi-logline.err .lt{color:var(--dsw-alias-state-error-primary,#FF6B6B)}
.madazi-logfix{flex:none;font-size:10px;padding:0 6px;border:1px solid color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 40%,transparent);border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 8%,transparent);color:var(--dsw-alias-accent-primary,#4c8ffd);cursor:pointer;opacity:.35}
.madazi-logline:hover .madazi-logfix{opacity:1}
.madazi-fixbar{margin-top:6px;padding:6px 8px;border:1px solid color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 35%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 6%,transparent);font-size:11px;color:var(--dsw-alias-label-primary,#0f1115);display:flex;flex-direction:column;gap:6px}
.madazi-fixbar .acts{display:flex;gap:6px;justify-content:flex-end}
/* 成员弹窗添加角色选择 */
.madazi-members-roles{display:flex;gap:6px;margin-bottom:4px}
.madazi-role-btn{flex:1;padding:3px 8px;font-size:11px;border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#61666b);cursor:pointer}
.madazi-role-btn:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}
.madazi-role-btn.on{background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 14%,transparent);border-color:var(--dsw-alias-accent-primary,#4c8ffd);color:var(--dsw-alias-accent-primary,#4c8ffd)}
/* 管理 tab 内子 tab（用户管理 / Key与登录 / 系统设置） */
.madazi-admin-tabs{display:flex;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));padding-bottom:8px}
.madazi-admin-tab{flex:1;padding:6px 10px;font-size:12px;line-height:18px;border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#61666b);cursor:pointer;white-space:nowrap;text-align:center;font-family:inherit}
.madazi-admin-tab:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#0f1115)}
.madazi-admin-tab.on{background:color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 14%,transparent);border-color:var(--dsw-alias-accent-primary,#4c8ffd);color:var(--dsw-alias-accent-primary,#4c8ffd);font-weight:600}
.madazi-admin-pane{display:flex;flex-direction:column;gap:12px}
`;
const tagId = "@madazi/dsh-plugin-madazi/style.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "@madazi/dsh-plugin-madazi";
	tag.dataset.pluginCss = tagId;
	tag.textContent = css;
	document.head.appendChild(tag);
}

// ═══════════════════════════════════════════════════════════════
// src/02-typert.js
// ═══════════════════════════════════════════════════════════════
		const NS = "madaziHello";

		// apply(ctx) 时捕获 ctx：factory 顶层组件（CreateProjectForm 等）不在 apply 作用域内
		let _madaziCtx = null;

		/** Client services required by this plugin. */
		const inject = ["slots", "locale", "remote", "sessions", "workspaces"];

		/** Generated Host Remote contribution: mirrors dsh-api-remotes' $mount contract. */
		const TYPERT_REMOTE = {
			package: "@madazi/dsh-plugin-madazi",
			descriptors: [{
				id: "@madazi/dsh-plugin-madazi#madazi/listProjects",
				service: "madazi",
				namespace: "madazi",
				method: "listProjects",
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectList",
					schema: { parse: (v) => v }
				}
			}, {
				id: "@madazi/dsh-plugin-madazi#madazi/getProject",
				service: "madazi",
				namespace: "madazi",
				method: "getProject",
				invocation: { kind: "direct" },
				parameters: [{
					name: "id",
					wire: "id",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#Project",
					schema: { parse: (v) => v }
				}
			}, {
				id: "@madazi/dsh-plugin-madazi#madazi/listTasks",
				service: "madazi",
				namespace: "madazi",
				method: "listTasks",
				invocation: { kind: "direct" },
				parameters: [{
					name: "projectId",
					wire: "projectId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#TaskList",
					schema: { parse: (v) => v }
				}
			}, {
				id: "@madazi/dsh-plugin-madazi#madazi/cancelTask",
				service: "madazi",
				namespace: "madazi",
				method: "cancelTask",
				invocation: { kind: "direct" },
				parameters: [{
					name: "projectId",
					wire: "projectId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: { parse: (v) => v } }
				}, {
					name: "taskId",
					wire: "taskId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#TaskId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#CancelResult",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/previewStatus",
				service: "madazi",
				namespace: "madazi",
				method: "previewStatus",
				invocation: { kind: "direct" },
				parameters: [{
					name: "projectId",
					wire: "projectId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#PreviewStatus",
					schema: { parse: (v) => v }
				}
			}, {
				id: "@madazi/dsh-plugin-madazi#madazi/previewStart",
				service: "madazi",
				namespace: "madazi",
				method: "previewStart",
				invocation: { kind: "direct" },
				parameters: [{
					name: "projectId",
					wire: "projectId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#PreviewStartResult",
					schema: { parse: (v) => v }
				}
			}, {
				id: "@madazi/dsh-plugin-madazi#madazi/previewStop",
				service: "madazi",
				namespace: "madazi",
				method: "previewStop",
				invocation: { kind: "direct" },
				parameters: [{
					name: "projectId",
					wire: "projectId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#PreviewStopResult",
					schema: { parse: (v) => v }
				}
			}, {
				id: "@madazi/dsh-plugin-madazi#madazi/previewRestart",
				service: "madazi",
				namespace: "madazi",
				method: "previewRestart",
				invocation: { kind: "direct" },
				parameters: [{
					name: "projectId",
					wire: "projectId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#PreviewRestartResult",
					schema: { parse: (v) => v }
				}
			}, {
				id: "@madazi/dsh-plugin-madazi#madazi/previewHardRestart",
				service: "madazi",
				namespace: "madazi",
				method: "previewHardRestart",
				invocation: { kind: "direct" },
				parameters: [{
					name: "projectId",
					wire: "projectId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#PreviewRestartResult",
					schema: { parse: (v) => v }
				}
			}, {
				id: "@madazi/dsh-plugin-madazi#madazi/listRunningPreviews",
				service: "madazi",
				namespace: "madazi",
				method: "listRunningPreviews",
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#RunningPreviews",
					schema: { parse: (v) => v }
				}
			}, {
				id: "@madazi/dsh-plugin-madazi#madazi/previewLogs",
				service: "madazi",
				namespace: "madazi",
				method: "previewLogs",
				invocation: { kind: "direct" },
				parameters: [{
					name: "projectId",
					wire: "projectId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#PreviewLogsResult",
					schema: { parse: (v) => v }
				}
			}, {
				id: "@madazi/dsh-plugin-madazi#madazi/listTemplates",
				service: "madazi",
				namespace: "madazi",
				method: "listTemplates",
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#TemplateList",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/createProject",
				service: "madazi",
				namespace: "madazi",
				method: "createProject",
				invocation: { kind: "direct" },
				parameters: [{
					name: "payload",
					wire: "payload",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#CreateProjectPayload", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#Project",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/getMe",
				service: "madazi",
				namespace: "madazi",
				method: "getMe",
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#Me",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/resolveWorkspace",
				service: "madazi",
				namespace: "madazi",
				method: "resolveWorkspace",
				invocation: { kind: "direct" },
				parameters: [{
					name: "workspaceId",
					wire: "workspaceId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#WorkspaceId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#WorkspaceInfo",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/listKeys",
				service: "madazi",
				namespace: "madazi",
				method: "listKeys",
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#KeyList",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/createKey",
				service: "madazi",
				namespace: "madazi",
				method: "createKey",
				invocation: { kind: "direct" },
				parameters: [{
					name: "payload",
					wire: "payload",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#CreateKeyPayload", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#Key",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/revokeKey",
				service: "madazi",
				namespace: "madazi",
				method: "revokeKey",
				invocation: { kind: "direct" },
				parameters: [{
					name: "id",
					wire: "id",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#KeyId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#RevokeResult",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/usageSummary",
				service: "madazi",
				namespace: "madazi",
				method: "usageSummary",
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#UsageSummary",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/listUsers",
				service: "madazi",
				namespace: "madazi",
				method: "listUsers",
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#UserList",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/createUser",
				service: "madazi",
				namespace: "madazi",
				method: "createUser",
				invocation: { kind: "direct" },
				parameters: [{
					name: "payload",
					wire: "payload",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#CreateUserPayload", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#User",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/deleteUser",
				service: "madazi",
				namespace: "madazi",
				method: "deleteUser",
				invocation: { kind: "direct" },
				parameters: [{
					name: "id",
					wire: "id",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#UserId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#DeleteResult",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/updateUserRole",
				service: "madazi",
				namespace: "madazi",
				method: "updateUserRole",
				invocation: { kind: "direct" },
				parameters: [{
					name: "id",
					wire: "id",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#UserId", schema: { parse: (v) => v } }
				}, {
					name: "role",
					wire: "role",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#Role", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#User",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/listAllKeys",
				service: "madazi",
				namespace: "madazi",
				method: "listAllKeys",
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#KeyList",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/getProjectOnlineUsers",
				service: "madazi",
				namespace: "madazi",
				method: "getProjectOnlineUsers",
				invocation: { kind: "direct" },
				parameters: [{
					name: "projectId",
					wire: "projectId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#OnlineUsers",
					schema: { parse: (v) => v }
				}
				}]
				};

// ═══════════════════════════════════════════════════════════════
// src/03-shared.js
// ═══════════════════════════════════════════════════════════════
		/** Render one project row. */
		const ProjectRow = (p) => h("div", { className: "p", key: p.id },
			h("span", { className: "pn" }, p.name || p.id),
			h("span", { className: "pd" }, p.description || "")
		);

		/** Platform panel docked into the composer area: lists madazi projects via the node-half bridge. */
		const MadaziPanel = (props) => {
			const [projects, setProjects] = useState(null);
			const [error, setError] = useState(null);
			useEffect(() => {
				if (!props.fetchProjects) return;
				let alive = true;
				const tryFetch = (attempt) => {
					if (!alive) return;
					// 8s 超时保护：RPC 通道挂起时不再永久 loading
					const timed = Promise.race([
						props.fetchProjects(),
						new Promise((_, rej) => setTimeout(() => rej(new Error("RPC_TIMEOUT 8s")), 8000))
					]);
					timed.then((data) => {
						if (!alive) return;
						if (data && data.error) {
							window.__madaziLastErr = { phase: "data.error", data };
							if (attempt < 8) { setTimeout(() => tryFetch(attempt + 1), 1500); return; }
							setError(typeof data.error === "object" ? JSON.stringify(data.error) : data.error);
							return;
						}
						const list = data && data.ok ? data.value : data;
						setProjects(Array.isArray(list) ? list : []);
					}).catch((e) => {
						if (!alive) return;
						window.__madaziLastErr = { phase: "reject", msg: String(e && e.message), stack: String(e && e.stack).slice(0, 400) };
						if (attempt < 8) { setTimeout(() => tryFetch(attempt + 1), 1500); return; }
						setError(String((e && e.message) || e));
					});
				};
				tryFetch(0);
				return () => { alive = false; };
			}, []);
			const rows = projects === null
				? h("div", { className: "d" }, "加载平台项目…")
				: projects.length === 0
					? h("div", { className: "d" }, "暂无项目")
					: projects.map(ProjectRow);
			return h("div", { className: "madazi-hello" },
				h("div", { className: "t" },
					h("span", null, "Madazi 平台面板"),
					h("span", { className: "badge" }, "平台项目")
				),
				error ? h("div", { className: "d" }, "API: " + error) : rows
			);
		};

		/**
		 * Directory-flow occupant: replaces the built-in directory browser in the
		 * "Add workspace" flow. Picking a platform project adopts its directory as
		 * a workspace (owner calls createWorkspace + opens a session).
		 * Registered at priority -1 to shadow dsh-client-ui-directory-picker-browse.
		 */
		// ── 平台模板解析：id 形如 react-node / react+node / uniapp-springboot ──
		const parseTemplates = (templates) => (templates || []).map((t) => {
			const id = t.id || "";
			const m = id.match(/^([a-zA-Z]+)[+-]([a-zA-Z]+)$/);
			return { ...t, front: m ? m[1] : "", back: m ? m[2] : "" };
		});
		const FRONT_LABELS = { react: "React", vue: "Vue", uniapp: "uni-app" };
		const BACK_LABELS = { node: "Node.js", springboot: "Spring Boot" };
		const APPTYPE_LABELS = { web: "Web 应用", internal: "内部工具", miniapp: "微信小程序", mobile: "移动端", desktop: "桌面端" };
		const findTpl = (parsed, front, back) => parsed.find((t) => t.front === front && t.back === back);

		/**
		 * 共享「新建项目」表单（UI 统一铁律：全部用官方 primitives）。
		 * mode=create：项目名称 + 前端技术栈 + 后端技术栈 + 应用类型（模板创建）
		 * mode=git：   项目名称 + Git 地址（POST /api/projects/import-git，SSE 流式）
		 * mode=upload：项目名称 + zip 文件（POST /api/projects/import-zip，SSE 流式）
		 */
		const consumeSSE = async (resp, onEvent) => {
			const reader = resp.body.getReader();
			const dec = new TextDecoder();
			let buf = "";
			let project = null;
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += dec.decode(value, { stream: true });
				const lines = buf.split("\n");
				buf = lines.pop() || "";
				for (const line of lines) {
					const t = line.trim();
					if (!t.startsWith("data:")) continue;
					let evt;
					try { evt = JSON.parse(t.slice(5).trim()); } catch { continue; }
					if (evt && onEvent) onEvent(evt);
					if (evt && evt.type === "done" && evt.project) project = evt.project;
					if (evt && evt.type === "error") { try { await reader.cancel(); } catch { /* ignore */ } throw new Error(evt.error || "导入失败"); }
					if (project) { try { await reader.cancel(); } catch { /* ignore */ } return project; }
				}
			}
			return project;
		};

// ═══════════════════════════════════════════════════════════════
// src/04-create-form.js
// ═══════════════════════════════════════════════════════════════
		const CreateProjectForm = ({ mode = "create", templates, busy, onSubmit }) => {
			const [cName, setCName] = useState("");
			const [front, setFront] = useState(null);
			const [back, setBack] = useState(null);
			const [err, setErr] = useState(null);
			const [cBusy, setCBusy] = useState(false);
			const [feOpen, setFeOpen] = useState(false);
			const [beOpen, setBeOpen] = useState(false);
			const [gitUrl, setGitUrl] = useState("");
			const [zipFile, setZipFile] = useState(null);
			const [progress, setProgress] = useState([]);
			const [doneProj, setDoneProj] = useState(null);
			const logRef = useRef(null);
			useEffect(() => {
				const el = logRef.current;
				if (el) el.scrollTop = el.scrollHeight;
			}, [progress]);
			const parsed = parseTemplates(templates);
			useEffect(() => {
				if (front === null && parsed.length) {
					const t0 = parsed[0];
					setFront(t0.front);
					setBack(t0.back);
				}
			}, [templates]);
			const tpl = findTpl(parsed, front, back);
			const frontOptions = Array.from(new Set(parsed.map((t) => t.front).filter(Boolean)));
			const backOptions = Array.from(new Set(parsed.map((t) => t.back).filter(Boolean)));
			const create = async () => {
				if (cBusy || busy) return;
				if (!cName.trim()) { setErr("项目名不能为空"); return; }
				if (!tpl) {
					setErr("暂不支持该前后端组合：" + (FRONT_LABELS[front] || front || "?") + " + " + (BACK_LABELS[back] || back || "?"));
					return;
				}
				setCBusy(true);
				setErr(null);
				try {
					// ★ 直连 server API（同源 cookie 鉴权，与项目列表 madaziFetch 一致），
					//   跳过 Typert RPC（client→host→server 多一跳，创建体验更慢）
					const resp = await fetch("/api/projects", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ name: cName.trim(), tech_stack: tpl.id, app_type: "web" }),
					});
					const data = await resp.json().catch(() => ({}));
					if (!resp.ok) {
						setErr((data && data.error) || ("创建失败 HTTP " + resp.status));
						return;
					}
					onSubmit(data);
				} catch (e) {
					setErr(String((e && e.message) || e));
				} finally {
					setCBusy(false);
				}
			};
			const submitGit = async () => {
				if (cBusy || busy) return;
				if (!cName.trim()) { setErr("项目名不能为空"); return; }
				if (!/^https?:\/\/.+|^git@.+/.test(gitUrl.trim())) { setErr("Git 地址格式不正确（支持 https:// 或 git@）"); return; }
				setCBusy(true);
				setErr(null);
				setProgress([]);
				setDoneProj(null);
				try {
					const resp = await fetch("/api/projects/import-git", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ name: cName.trim(), gitUrl: gitUrl.trim() }),
					});
					if (!resp.ok) {
						const j = await resp.json().catch(() => ({}));
						setErr(j.error || ("导入失败 HTTP " + resp.status));
						return;
					}
					const project = await consumeSSE(resp, (evt) => {
						if (evt.type === "log") setProgress((p) => [...p, evt.text]);
					});
					if (!project) { setErr("导入未返回项目结果"); return; }
					setDoneProj(project);
				} catch (e) {
					setErr(String((e && e.message) || e));
				} finally {
					setCBusy(false);
				}
			};
			const submitUpload = async () => {
				if (cBusy || busy) return;
				if (!cName.trim()) { setErr("项目名不能为空"); return; }
				if (!zipFile) { setErr("请选择 zip 压缩包"); return; }
				setCBusy(true);
				setErr(null);
				setProgress([]);
				setDoneProj(null);
				try {
					const fd = new FormData();
					fd.append("name", cName.trim());
					fd.append("zip", zipFile);
					const resp = await fetch("/api/projects/import-zip", { method: "POST", body: fd });
					if (!resp.ok) {
						const j = await resp.json().catch(() => ({}));
						setErr(j.error || ("上传失败 HTTP " + resp.status));
						return;
					}
					const project = await consumeSSE(resp, (evt) => {
						if (evt.type === "log") setProgress((p) => [...p, evt.text]);
					});
					if (!project) { setErr("上传未返回项目结果"); return; }
					setDoneProj(project);
				} catch (e) {
					setErr(String((e && e.message) || e));
				} finally {
					setCBusy(false);
				}
			};
			const fieldBtn = (label, onClick) => h(Button, {
				variant: "ghost", size: "md", type: "button",
				"aria-haspopup": "menu", "aria-expanded": false,
				onClick,
				style: { justifyContent: "space-between", width: "100%" },
			}, label, h(IconChevronDownOutline14, null));
			const labelCls = { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } };
			const logBox = progress.length
				? h("div", { ref: logRef, style: { fontSize: 11, lineHeight: 1.6, color: "var(--dsw-alias-label-secondary)", background: "var(--dsw-surface, rgba(128,128,128,0.08))", borderRadius: 8, padding: "8px 10px", maxHeight: 120, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" } },
					progress.map((t, i) => h("div", { key: i }, t)))
				: null;
			const doneBox = doneProj
				? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-success-primary,#34C759)", fontWeight: 600 } }, "✓ 导入完成：" + (doneProj.name || doneProj.id))
				: null;
			const finishImport = () => { onSubmit(doneProj); };
			const submitBtn = (busyText, idleText, onGo) => doneProj
				? h(Button, { variant: "primary", size: "md", onClick: finishImport, style: { alignSelf: "flex-end" } }, "完成，进入对话")
				: h(Button, { variant: "primary", size: "md", disabled: cBusy || busy, onClick: onGo, style: { alignSelf: "flex-end" } },
					cBusy ? busyText : idleText);
			if (mode === "git") {
				return h("div", { style: { display: "flex", flexDirection: "column", gap: 12 } },
					h("label", labelCls, "项目名称"),
					h(Input, { value: cName, placeholder: "例如：进销存管理系统", onChange: (e) => setCName(e.target.value), style: { width: "100%" } }),
					h("label", labelCls, "Git 仓库地址"),
					h(Input, { value: gitUrl, placeholder: "https://github.com/xxx/yyy.git 或 git@github.com:xxx/yyy.git", onChange: (e) => setGitUrl(e.target.value), style: { width: "100%" } }),
					err ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, err) : null,
					logBox,
					doneBox,
					submitBtn("导入中…", "导入并进入对话", submitGit)
				);
			}
			if (mode === "upload") {
				return h("div", { style: { display: "flex", flexDirection: "column", gap: 12 } },
					h("label", labelCls, "项目名称"),
					h(Input, { value: cName, placeholder: "例如：进销存管理系统", onChange: (e) => setCName(e.target.value), style: { width: "100%" } }),
					h("label", labelCls, "zip 压缩包（≤200MB）"),
					h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
						h(Button, { variant: "ghost", size: "md", type: "button", onClick: () => { const el = document.createElement("input"); el.type = "file"; el.accept = ".zip,application/zip"; el.onchange = () => { if (el.files && el.files[0]) { setZipFile(el.files[0]); setErr(null); } }; el.click(); } },
							"选择文件…"),
						zipFile ? h("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-primary)" } }, zipFile.name + " (" + Math.round(zipFile.size / 1024) + " KB)") : null
					),
					err ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, err) : null,
					logBox,
					doneBox,
					submitBtn("上传中…", "上传并进入对话", submitUpload)
				);
			}
			return h("div", { style: { display: "flex", flexDirection: "column", gap: 12 } },
				h("label", labelCls, "项目名称"),
				h(Input, { value: cName, placeholder: "例如：进销存管理系统", onChange: (e) => setCName(e.target.value), style: { width: "100%" } }),
				h("label", labelCls, "前端技术栈"),
				h(Menu, {
					open: feOpen,
					onClose: () => setFeOpen(false),
					items: frontOptions.map((f) => ({ id: f, label: FRONT_LABELS[f] || f })),
					selectedId: front || undefined,
					onSelect: (id) => { setFeOpen(false); setFront(id); setErr(null); const t = findTpl(parsed, id, back); if (t && t.app_types && t.app_types.length) setAppType(t.app_types[0]); },
					align: "start",
					anchor: fieldBtn(FRONT_LABELS[front] || "选择前端", () => setFeOpen(!feOpen)),
				}),
				h("label", labelCls, "后端技术栈"),
				h(Menu, {
					open: beOpen,
					onClose: () => setBeOpen(false),
					items: backOptions.map((b) => ({ id: b, label: BACK_LABELS[b] || b })),
					selectedId: back || undefined,
					onSelect: (id) => { setBeOpen(false); setBack(id); setErr(null); },
					align: "start",
					anchor: fieldBtn(BACK_LABELS[back] || "选择后端", () => setBeOpen(!beOpen)),
				}),
				err ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, err) : null,
				h(Button, { variant: "primary", size: "md", disabled: cBusy || busy, onClick: create, style: { alignSelf: "flex-end" } },
					cBusy ? "创建中…" : "创建并进入对话")
			);
		};

		/**
		 * S3 hero 区项目信息行：会话列表上方常驻显示 创建人头像 + 项目名 + 成员头像 + 加号（管理成员弹窗）。
		 * 数据源优先级：slot 传 useSessions（cwd 匹配 <部署根>/generated/<pid>）→ rest.workspace.path → RPC resolveWorkspace(workspaceId) → localStorage 最近打开。
		 */
		// ★ 平台项目 id 提取（部署无关）：path/cwd 形如 <任意根>/generated/<uuid>，
		//   与 wb-src / session-access 同款正则——不区分 /app/generated 或单机版 PROJECTS_ROOT。
		const pidFromPlatformPath = (p) => {
			const m = String(p || "").match(/[\\/]generated[\\/]([0-9a-fA-F-]{36})/);
			return m ? m[1] : null;
		};
		const ProjectHeroBar = ({ rest }) => {
			const useSessions = rest && rest.useSessions;
			const cwd = useSessions
				? useSessions((s) => {
						const byId = s && s.byId;
						if (!byId) return null;
						for (const k of Object.keys(byId)) {
							const c = byId[k] && byId[k].cwd;
							if (c && pidFromPlatformPath(c)) return c;
						}
						return null;
					})
				: null;
			const [projectId, setProjectId] = useState(null);
			const [proj, setProj] = useState(null);
			const [members, setMembers] = useState(null);
			const [me, setMe] = useState(null);
			const [manageOpen, setManageOpen] = useState(false);
			useEffect(() => {
				try { if (window && !window.__madaziHeroProps) window.__madaziHeroProps = Object.keys(rest || {}); } catch { /* ignore */ }
				let pid = pidFromPlatformPath(cwd) || null;
				if (!pid && rest) {
					const wsp = (rest.workspace && rest.workspace.path) || (rest.currentWorkspace && rest.currentWorkspace.path);
					pid = pidFromPlatformPath(wsp) || null;
				}
				if (!pid) {
					try {
						const l = window.localStorage.getItem("madazi:lastProject");
						if (l) { const o = JSON.parse(l); if (o && o.projectId) pid = o.projectId; }
					} catch { /* ignore */ }
				}
				setProjectId(pid);
				// workspaceId → RPC 兜底（异步；dsh workspace id 非项目 uuid，须 node 半解析 path）
				const wid = rest && (rest.workspaceId || (rest.workspace && rest.workspace.id));
				if (wid && window.__madaziSvc && window.__madaziSvc.resolveWorkspace) {
					window.__madaziSvc.resolveWorkspace(wid).then((r) => {
						const v = r && r.ok ? r.value : r;
						const rp = pidFromPlatformPath(v && v.path);
						if (rp) setProjectId(rp);
					}).catch(() => { /* ignore */ });
				}
			}, [cwd]);
			useEffect(() => {
				if (!projectId || !window.__madaziSvc) return;
				let alive = true;
				Promise.all([
					window.__madaziSvc.getProject(projectId),
					window.__madaziSvc.listProjectMembers(projectId),
					window.__madaziSvc.getMe()
				]).then(([p, m, meRes]) => {
					if (!alive) return;
					const pv = p && p.ok ? p.value : p;
					const mv = m && m.ok ? m.value : m;
					const mev = meRes && meRes.ok ? meRes.value : meRes;
					setProj(pv && pv.name ? pv : null);
					setMembers(mv && mv.owner ? mv : null);
					setMe(mev && (mev.id || mev.user_id) ? mev : null);
				}).catch(() => { /* ignore */ });
				return () => { alive = false; };
			}, [projectId]);
			if (!projectId || !proj || !members) return null;
			const owner = members.owner || { username: "?" };
			const memberList = Array.isArray(members.members) ? members.members : [];
			const shown = memberList.slice(0, 6);
			const letter = (name) => (name && name[0] ? name[0] : "?").toUpperCase();
			return h("div", { className: "madazi-hero-row" }, [
				h("div", { className: "madazi-hero-owner", title: "创建人 " + (owner.username || "") }, letter(owner.username)),
				h("div", { className: "madazi-hero-name", title: proj.name }, proj.name),
				h("div", { className: "madazi-hero-members" }, [
					shown.map((m) => h("div", { key: m.user_id, className: "madazi-hero-mavatar", title: m.username }, letter(m.username))),
					memberList.length > 6 ? h("div", { key: "more", className: "madazi-hero-mavatar madazi-hero-more", title: "共 " + memberList.length + " 名成员" }, "+" + (memberList.length - 6)) : null
				]),
				h("div", { className: "madazi-hero-spacer" }),
				h(Button, { variant: "ghost", size: "sm", className: "madazi-hero-add", title: "管理项目成员", onClick: () => setManageOpen(true) }, "+"),
				manageOpen ? h(MembersModal, { project: Object.assign({}, proj, { members: memberList, owner }), me: me || {}, onClose: () => setManageOpen(false) }) : null
			]);
		};

		/**
		 * Directory-flow occupant: replaces the built-in directory browser in the
		 * "Add workspace" flow. Picking a platform project adopts its directory as
		 * a workspace (owner calls createWorkspace + opens a session).
		 * Registered at priority -1 to shadow dsh-client-ui-directory-picker-browse.
		 */
		const ProjectDirectoryFlow = ({ open, busy, onPicked, onCancel, onError, ...rest }) => {
			// ★ 重构（2026-08-23）：两级结构——首页选「创建方式」（模板/Git/本地 明确区分），点入各自流程
			const [view, setView] = useState("home"); // home（选择方式） | tpl（模板创建） | git | upload | market
			const [templates, setTemplates] = useState(null);
			const [error, setError] = useState(null);
			// 快速创建态：项目名 + 选中模板
			const [qName, setQName] = useState("");
			const [qTpl, setQTpl] = useState(null);
			const [qBusy, setQBusy] = useState(false);
			useEffect(() => {
				if (!open || !window.__madaziSvc) return;
				let alive = true;
				setView("home");
				setError(null);
				setQName("");
				setQTpl(null);
				if (window.__madaziSvc.listTemplates) {
					window.__madaziSvc.listTemplates().then((data) => {
						if (!alive) return;
						const list = data && data.ok ? data.value : data;
						setTemplates(Array.isArray(list) ? list : []);
					}).catch((e) => {
						if (!alive) return;
						window.__madaziLastErr = { phase: "templates.reject", msg: String((e && e.message) || e) };
						console.error("[madazi] listTemplates failed:", e);
						setError("模板加载失败: " + String((e && e.message) || e));
					});
				}
				return () => { alive = false; };
			}, [open]);
			if (!open) return null;
			const parsed = parseTemplates(templates);
			// ★ 统一打开（模板快速创建 / git / zip / 市场装模板共用）：
			//   create → rename(项目名) → startSession 即时命名，无 uuid 窗口。
			//   回退：__madaziOpenProject 不可用时走官方 onPicked 目录流（title=uuid，靠 watch 兜底）
			const openCreated = (proj) => {
				const pid = proj && proj.id;
				// ★ 2026-09-06 修复：市场模板/新建/Git/上传 创建成功后关闭目录流弹窗。
				//   此前市场视图 onInstalled=openCreated 只打开项目，Modal open:true 固定不关，
				//   弹窗残留。打开项目后再 onCancel() 关闭（异步打开不阻塞关闭）。
				// 回退：__madaziOpenProject 不可用时走官方 onPicked 目录流——真实路径经
				// B12 专用接口由 server 推导（无硬编码 /app/generated 或开发机路径）。
				const task = pid && window.__madaziOpenProject
					? window.__madaziOpenProject(proj).catch(() => {})
					: window.__madaziResolveWorkspacePath(pid)
						.then((p) => (p ? onPicked(p) : Promise.resolve()))
						.catch(() => {});
				if (typeof task !== "undefined" && typeof task.then === "function") task.finally(() => { try { onCancel(); } catch { /* ignore */ } });
				else try { onCancel(); } catch (e) { /* ignore */ }
			};
			const quickCreate = async () => {
				if (qBusy || busy) return;
				if (!qName.trim()) { setError("项目名不能为空"); return; }
				const tpl = parsed.find((t) => t.id === qTpl);
				if (!tpl) { setError("请选择一个模板"); return; }
				setQBusy(true);
				setError(null);
				try {
					// ★ 创建必须走当前登录用户身份（同源 cookie 直连）：原 madaziSvc.createProject
					//   走 node 半 SVC_TOKEN（服务身份），创建的项目 owner 被记为 admin——普通用户
					//   建的项目自己反而看不到。git/upload 已是同源 fetch，这里对齐。
					const data = await madaziFetch("/projects", { method: "POST", body: JSON.stringify({ name: qName.trim(), tech_stack: tpl.id, app_type: "web" }) });
					if (data && data.error) {
						setError(typeof data.error === "object" ? JSON.stringify(data.error) : data.error);
						return;
					}
					const proj = data && data.ok ? data.value : data;
					openCreated(proj);
				} catch (e) {
					setError(String((e && e.message) || e));
				} finally {
					setQBusy(false);
				}
			};
			// ── 首页（默认）：模板创建为主（项目名 + 官方模板网格），Git/本地为底部次级卡片 ──
			const tplBody = h("div", { className: "madazi-quick" },
				h(Input, { value: qName, placeholder: "项目名称，例如：进销存管理系统", onChange: (e) => { setQName(e.target.value); if (error) setError(null); }, style: { width: "100%" } }),
				error
					? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)", marginBottom: 4 } }, error)
					: null,
				templates === null
					? h("div", { style: { padding: 16, fontSize: 13, color: "var(--dsw-alias-label-secondary)" } }, "模板加载中…")
					: parsed.length === 0
						? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } }, "暂无官方模板")
						: h("div", { className: "madazi-quick-grid" },
							parsed.map((t) => h("button", {
								key: t.id, type: "button",
								className: "madazi-quick-card" + (qTpl === t.id ? " on" : ""),
								onClick: () => { setQTpl(t.id); setError(null); },
							},
								h("div", { className: "madazi-quick-card-hd" },
									h("span", { className: "madazi-mkt-icon" }, ((FRONT_LABELS[t.front] || t.front || "?").slice(0, 1) + (BACK_LABELS[t.back] || t.back || "?").slice(0, 1))),
									h("span", { className: "madazi-quick-card-tech" }, (FRONT_LABELS[t.front] || t.front || "?") + " + " + (BACK_LABELS[t.back] || t.back || "?"))),
								t.description ? h("div", { className: "madazi-quick-card-desc" }, t.description) : null
							))),
			h(Button, { variant: "primary", size: "md", disabled: qBusy || busy || !qTpl, onClick: quickCreate, style: { alignSelf: "stretch" } },
				qBusy ? "创建中…" : "创建并进入对话"),
			h("div", { className: "madazi-quick-more" },
					h("button", { type: "button", className: "madazi-quick-more-btn", onClick: () => { setView("market"); setError(null); } }, "更多模板 · 模板市场")
				),
				// 次级创建方式：Git / 本地上传（让用户知晓还有这两种途径）
				h("div", { className: "madazi-way madazi-way-sub" },
					h("button", { type: "button", className: "madazi-way-card", onClick: () => { setView("git"); setError(null); } },
						h("span", { className: "madazi-way-t" }, "⑂ 从 Git 导入"),
						h("span", { className: "madazi-way-d" }, "克隆已有仓库到平台继续开发")),
					h("button", { type: "button", className: "madazi-way-card", onClick: () => { setView("upload"); setError(null); } },
						h("span", { className: "madazi-way-t" }, "⇧ 从本地上传"),
						h("span", { className: "madazi-way-d" }, "上传本地项目压缩包（zip）"))
				)
			);
			const modalTitle = view === "git" ? "从 Git 导入" : view === "upload" ? "从本地上传" : view === "market" ? "模板市场 · 全部模板" : "新建项目";
			return h(Modal, {
				open: true,
				onClose: () => onCancel(),
				title: modalTitle,
				closeLabel: "关闭",
				// 返回层级：market → home（模板创建首页）；git/upload → home
				footer: view !== "home"
					? h(Button, { variant: "ghost", size: "md", onClick: () => { setView("home"); setError(null); } }, "返回")
					: null,
				children: view === "git"
					? h(CreateProjectForm, { mode: "git", templates, busy, onSubmit: openCreated })
					: view === "upload"
						? h(CreateProjectForm, { mode: "upload", templates, busy, onSubmit: openCreated })
						: view === "market"
							// ★ 滚动约束：宽度由 _dialog_ 覆盖规则控制 + 限高 64vh 内滚
							? h("div", { className: "madazi-flow-modal-body" },
								h(TemplateMarketBrowser, { onInstalled: openCreated }))
							: tplBody,
			});
		};

// ═══════════════════════════════════════════════════════════════
// src/05-projects.js
// ═══════════════════════════════════════════════════════════════
		const ProjectsEntry = ({ wide, onOpenProject }) => {
			const [open, setOpen] = useState(false);
			const [view, setView] = useState("list"); // list | create
			const [projects, setProjects] = useState(null);
			const [templates, setTemplates] = useState(null);
			const [error, setError] = useState(null);
			const [busy, setBusy] = useState(false);
			// 行 ⋯ 菜单（管理成员 / 发布为模板）
			const [menuFor, setMenuFor] = useState(null);
			const [membersProject, setMembersProject] = useState(null);
			const [publishProject, setPublishProject] = useState(null);
			const [me, setMe] = useState(null);
			useEffect(() => {
				if (!open) return;
				madaziFetch("/auth/me").then((d) => {
					const v = d && !d.error ? (d.user || d) : null;
					if (v && v.id) setMe(v);
				}).catch(() => {});
			}, [open]);
			// 注：官方侧栏项目菜单「发布为模板」的弹窗由常驻 PublishHost（独立 React root，
			// startSortMenuInject 挂载）承接；此处不再监听事件（组件仅弹窗打开时挂载，且会双弹）。
			// publishProject 仅服务弹窗内 ⋯ 菜单入口（setPublishProject 组件内调用）。
			useEffect(() => {
			if (!open) return;
			let alive = true;
			const doRefresh = () => {
				madaziFetch("/projects").then((list) => {
					if (!alive) return;
					if (list && list.error) {
						window.__madaziLastErr = { phase: "projects.data.error", data: list };
						setError(typeof list.error === "object" ? JSON.stringify(list.error) : list.error);
						return;
					}
					setProjects(Array.isArray(list) ? list : []);
				}).catch((e) => {
					if (!alive) return;
					window.__madaziLastErr = { phase: "projects.reject", msg: String((e && e.message) || e) };
					setError(String((e && e.message) || e));
				});
			};
			doRefresh();
			if (window.__madaziSvc && window.__madaziSvc.listTemplates) {
					window.__madaziSvc.listTemplates().then((data) => {
						if (!alive) return;
						const list = data && data.ok ? data.value : data;
						setTemplates(Array.isArray(list) ? list : []);
					}).catch((e) => {
						if (!alive) return;
						window.__madaziLastErr = { phase: "templates.reject", msg: String((e && e.message) || e) };
						console.error("[madazi] listTemplates failed:", e);
						setError("模板加载失败: " + String((e && e.message) || e));
					});
				}
			// ★ 协同实时：被加进项目 → 自动重拉列表（配合全局 WS member_added）
			const onMemberAdded = () => { if (alive) doRefresh(); };
			if (window.__madaziProjectRefresh) window.__madaziProjectRefresh.push(onMemberAdded);
			return () => {
				alive = false;
				const i = window.__madaziProjectRefresh && window.__madaziProjectRefresh.indexOf(onMemberAdded);
				if (i >= 0) window.__madaziProjectRefresh.splice(i, 1);
			};
			}, [open]);
			const openProject = async (p) => {
				if (busy) return;
				setBusy(true);
				setError(null);
				try {
					await onOpenProject(p);
					setOpen(false);
				} catch (e) {
					window.__madaziLastErr = { phase: "projects.open", msg: String((e && e.message) || e) };
					setError(String((e && e.message) || e));
				} finally {
					setBusy(false);
				}
			};
			const handleCreated = async (proj) => {
			window.__madaziLastCreated = proj;
			setOpen(false);
			setView("list");
			// ★ 建完立即刷新 membership 成员表（gate 放行新项目，侧边栏即时显示 + 会话不被清除，
			//   否则要等下一轮 30s 轮询，新项目 10-30s 才出现）
			try { if (window.__madaziMembershipRefresh) window.__madaziMembershipRefresh(); } catch { /* ignore */ }
			// ★ 建完立即刷新项目列表（不等下次打开弹窗）
			madaziFetch("/projects").then((list) => {
				setProjects(Array.isArray(list) ? list : []);
			}).catch(() => {});
			// 建完直接进对话
			try { await onOpenProject(proj); } catch (e) {
				window.__madaziLastErr = { phase: "projects.create.open", msg: String((e && e.message) || e) };
			}
		};
			const switchCreate = () => { setView("create"); };
			const switchList = () => { setView("list"); };
			return h("div", { className: "madazi-footer-entry", style: { position: "relative" } },
				h("button", { className: "madazi-footer-btn", onClick: () => setOpen(!open), title: "平台项目" },
					h("span", null, wide ? "项目" : "项")
				),
				open && h("div", { className: "madazi-pop madazi-proj-pop" },
					h("div", { className: "madazi-pop-hd" },
						h("span", null, view === "create" ? "新建项目" : "平台项目"),
						h("span", { style: { display: "flex", gap: 6, alignItems: "center" } },
							view === "list"
								? h("button", { className: "madazi-newbtn", style: { margin: 0, padding: "2px 8px" }, onClick: switchCreate }, "＋新建")
								: h("button", { className: "madazi-btn-ghost", style: { padding: "2px 8px" }, onClick: switchList }, "返回")
						)
					),
					view === "create"
						? h("div", { className: "madazi-form" },
							h(CreateProjectForm, { templates, busy, onSubmit: handleCreated })
						)
						: projects === null
							? h("div", { className: "madazi-pop-d" }, "加载中…")
							: error
								? h("div", { className: "madazi-pop-d" }, "API: " + error)
								: projects.length === 0
									? h("div", { className: "madazi-pop-d" }, "暂无项目")
									: h("div", { className: "madazi-pop-l" }, projects.map((p) =>
										h("div", { key: p.id, className: "madazi-proj-row" },
											h("button", { className: "madazi-proj", onClick: () => openProject(p), disabled: busy },
												h("span", { className: "madazi-proj-n" }, p.name || p.title || p.id),
												h("span", { className: "madazi-proj-d" }, (p.description || "").slice(0, 40))
											),
											h("button", { className: "madazi-proj-more", title: "更多", onClick: () => setMenuFor(menuFor === p.id ? null : p.id) }, "⋯"),
											menuFor === p.id ? h("div", { className: "madazi-menu" },
												h("div", { className: "madazi-menu-item", onClick: () => { setMenuFor(null); setMembersProject(p); } }, "管理项目成员"),
												h("div", { className: "madazi-menu-item", onClick: () => { setMenuFor(null); setPublishProject(p); } }, "发布为模板")
											) : null
										)
									))
			),
			// 行 ⋯ 菜单弹出的二级 Modal
			membersProject ? h(MembersModal, { project: membersProject, me: me || {}, onClose: () => setMembersProject(null) }) : null,
			publishProject ? h(PublishTemplateModal, { project: publishProject, onClose: () => setPublishProject(null) }) : null
		);
		};


		/** Members modal (S3 多人协同): project roster managed by the owner /
		 * project admins; every member can view. Backed by the existing
		 * routes/members.js API (no server change needed). */
		const MembersModal = ({ project, me, onClose }) => {
			const [data, setData] = useState(null);      // { owner, members }
			const [err, setErr] = useState(null);
			const [msg, setMsg] = useState(null);
			const [busy, setBusy] = useState(null);
			const [q, setQ] = useState("");
			const [results, setResults] = useState(null); // 搜索候选
			const [role, setRole] = useState("developer"); // 新成员默认角色
			// S3 实时同步：project-ws 在线成员（同源 WS 自动携带 madazi_token cookie）
			const [online, setOnline] = useState([]); // [{id, username}]
			const load = () => {
				setErr(null); setMsg(null);
				// ★ 权限修复：同源 cookie 直连（后端 projectManageAccess 按登录用户判定）
				madaziFetch("/projects/" + project.id + "/members").then((v) => {
					if (v && v.error) { setErr(typeof v.error === "object" ? JSON.stringify(v.error) : String(v.error)); return; }
					setData(v && v.owner ? v : { owner: { user_id: "", username: "?", role: "owner" }, members: Array.isArray(v) ? v : [] });
				}).catch((e) => {
					const m = String((e && e.message) || e);
					window.__madaziLastErr = { phase: "members.load", msg: m };
					setErr(m);
				});
			};
			useEffect(() => { load(); }, [project.id]);
			// 实时在线成员：project-ws presence（进/出即广播）；失败静默（30s HTTP 轮询兜底）
			useEffect(() => {
				let ws = null;
				let timer = null;
				try {
					const proto = location.protocol === "https:" ? "wss://" : "ws://";
					ws = new WebSocket(proto + location.host + "/api/projects/" + project.id + "/ws");
					timer = setInterval(() => { try { if (ws.readyState === 1) ws.send(JSON.stringify({ type: "ping" })); } catch { /* ignore */ } }, 30000);
					ws.onmessage = (ev) => {
						try {
							const m = JSON.parse(ev.data);
							if (m.type === "presence" && Array.isArray(m.users)) setOnline(m.users);
						} catch { /* ignore */ }
					};
					ws.onerror = () => {}; // 兜底：HTTP /online 轮询
				} catch { /* ignore */ }
				return () => { try { clearInterval(timer); ws && ws.close(); } catch { /* ignore */ } };
			}, [project.id]);
			// 用户名搜索（300ms 防抖）
			useEffect(() => {
				if (!q.trim()) { setResults(null); return; }
				const t = setTimeout(() => {
					madaziFetch("/projects/" + project.id + "/members/search?q=" + encodeURIComponent(q.trim())).then((v) => {
						setResults(Array.isArray(v) ? v : []);
					}).catch(() => setResults([]));
				}, 300);
				return () => clearTimeout(t);
			}, [q]);
			const meId = me && (me.id || me.user_id);
			const members = (data && data.members) || [];
			const canManage = !!meId && (
				(data && data.owner && data.owner.user_id === meId)
				|| (me && me.role === "admin")
				|| members.some((m) => m.user_id === meId && m.role === "admin")
			);
			// ★ 移除权限收紧：仅创建人 + 平台管理员（系统 admin）可移除；项目管理员可加人/改角色但不能移除
			const canRemove = !!meId && (
				(data && data.owner && data.owner.user_id === meId)
				|| (me && me.role === "admin")
			);
			const showErr = (v) => {
				if (v && v.error) { setErr(typeof v.error === "object" ? JSON.stringify(v.error) : String(v.error)); return true; }
				return false;
			};
			const add = (u) => {
				if (busy) return;
				setBusy("add"); setErr(null); setMsg(null);
				madaziFetch("/projects/" + project.id + "/members", { method: "POST", body: JSON.stringify({ username: u.username, role }) }).then((v) => {
					if (showErr(v)) return;
					setMsg("已添加 " + u.username + (role === "admin" ? "（项目管理员）" : "（开发者）"));
					setQ(""); setResults(null); load();
				}).catch((e) => setErr(String((e && e.message) || e)))
					.finally(() => setBusy(null));
			};
			const flipRole = (m) => {
				if (busy) return;
				const nr = m.role === "admin" ? "developer" : "admin";
				setBusy("role:" + m.user_id); setErr(null); setMsg(null);
				madaziFetch("/projects/" + project.id + "/members/" + m.user_id, { method: "PUT", body: JSON.stringify({ role: nr }) }).then((v) => {
					if (showErr(v)) return;
					setMsg(m.username + " 已设为" + (nr === "admin" ? "项目管理员" : "开发者"));
					load();
				}).catch((e) => setErr(String((e && e.message) || e)))
					.finally(() => setBusy(null));
			};
			const remove = (m) => {
				if (busy) return;
				setBusy("rm:" + m.user_id); setErr(null); setMsg(null);
				madaziFetch("/projects/" + project.id + "/members/" + m.user_id, { method: "DELETE" }).then((v) => {
					if (showErr(v)) return;
					setMsg("已移除 " + m.username);
					load();
				}).catch((e) => setErr(String((e && e.message) || e)))
					.finally(() => setBusy(null));
			};
			const dot = (uid) => h("span", { className: "madazi-dot" + (online.some((u) => u.id === uid) ? " on" : "") }, "●");
			const ownerRow = data
				? h("div", { key: "owner", className: "madazi-user-row" },
					h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
						dot(data.owner.user_id),
						h("span", { className: "un" }, data.owner.username),
						h("span", { className: "madazi-role-badge" }, "创建人")),
					h("span", { className: "meta" }, online.some((u) => u.id === data.owner.user_id) ? "在线" : "离线"))
				: null;
			const memberRows = members.map((m) =>
				h("div", { key: m.user_id, className: "madazi-user-row" },
					h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
						dot(m.user_id),
						h("span", { className: "un" }, m.username),
						h("span", { className: "madazi-role-badge" }, m.role === "admin" ? "项目管理员" : "开发者")),
					canManage
						? h("div", { style: { display: "flex", gap: 6 } },
							h("button", { className: "madazi-btn-ghost", style: { padding: "2px 8px" }, disabled: !!busy, onClick: () => flipRole(m) },
								m.role === "admin" ? "设为开发者" : "设为管理员"),
							canRemove
								? h("button", { className: "madazi-btn-danger", disabled: !!busy, onClick: () => remove(m) }, "移除")
								: null)
						: h("span", { className: "meta" }, online.some((u) => u.id === m.user_id) ? "在线" : "离线"))
			);
			const addBox = canManage
				? h("div", { style: { padding: "10px 12px", borderTop: "1px solid var(--dsw-alias-border-l1)", display: "flex", flexDirection: "column", gap: 8 } },
					h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
						h("div", { style: { flex: 1 } },
							h(Input, { value: q, placeholder: "输入用户名添加成员", onChange: (e) => setQ(e.target.value), size: "md" })),
						h("button", { className: "madazi-btn-ghost", style: role === "admin" ? { borderColor: "color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 60%,transparent)", color: "var(--dsw-alias-accent-primary,#4c8ffd)" } : {}, onClick: () => setRole("admin") }, "管理员"),
						h("button", { className: "madazi-btn-ghost", style: role === "developer" ? { borderColor: "color-mix(in srgb,var(--dsw-alias-accent-primary,#4c8ffd) 60%,transparent)", color: "var(--dsw-alias-accent-primary,#4c8ffd)" } : {}, onClick: () => setRole("developer") }, "开发者")),
					q.trim()
						? (results === null
							? h("div", { className: "madazi-empty" }, "搜索中…")
							: results.length === 0
								? h("div", { className: "madazi-empty" }, "无匹配用户（可能已是成员）")
								: results.map((u) =>
									h(Button, { key: u.id, variant: "ghost", size: "md", disabled: !!busy, onClick: () => add(u), style: { justifyContent: "space-between", width: "100%" } },
										h("span", null, u.username),
										h("span", { style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary)" } }, "＋添加"))))
						: null)
				: h("div", { className: "madazi-empty" }, "仅创建人或项目管理员可管理成员");
			return h(Modal, {
				open: true,
				onClose,
				title: "项目成员 · " + (project.name || project.title || project.id),
				closeLabel: "关闭",
				footer: h(Button, { variant: "ghost", size: "md", onClick: onClose }, "完成"),
				children: h("div", { style: { display: "flex", flexDirection: "column" } },
					err ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)", padding: "6px 12px" } }, "API: " + err) : null,
					msg ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-success-primary,#34C759)", padding: "6px 12px" } }, msg) : null,
					online.length
						? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-success-primary,#34C759)", padding: "6px 12px", borderBottom: "1px solid var(--dsw-alias-border-l1)" } },
							"● 在线：" + online.map((u) => u.username).join("、"))
						: null,
					data === null
						? h("div", { className: "madazi-empty" }, "加载中…")
						: h("div", { style: { maxHeight: 260, overflowY: "auto" } }, ownerRow, memberRows),
					addBox)
			});
		};

// ═══════════════════════════════════════════════════════════════
// src/06-platform.js
// ═══════════════════════════════════════════════════════════════
		/** Platform section in the settings panel (P4): connection status,
		 * the platform project roster, an open-workspace action per row,
		 * personal account + usage summary. (API Keys 已合并到管理 → Key 与登录) */
		const PlatformSection = ({ close, onOpenProject }) => {
			const [projects, setProjects] = useState(null);
			const [me, setMe] = useState(null);
			const [usage, setUsage] = useState(null);
			const [error, setError] = useState(null);
			const [busy, setBusy] = useState(null);
			// S3 多人协同：成员管理弹窗（membersProject 非空时渲染 MembersModal）
			const [membersProject, setMembersProject] = useState(null);
			// 项目行 ⋯ 菜单（menuFor 非空时显示该项目的下拉菜单）
			const [menuFor, setMenuFor] = useState(null);
			// M3：发布为模板向导（publishProject 非空时渲染 PublishTemplateModal）
			const [publishProject, setPublishProject] = useState(null);
			const [startingPreview, setStartingPreview] = useState(null); // 一键预览：启动中项目 id
			// S3 实时同步：项目在线人数徽标（30s 轮询 /online；成员弹窗内为 WS 实时）
			const [onlineMap, setOnlineMap] = useState({});
			const projectsRef = useRef(null);
			const loadOnline = (list) => {
				if (!window.__madaziSvc || !list || !list.length) { setOnlineMap({}); return; }
				Promise.all(list.map((p) =>
					window.__madaziSvc.getProjectOnlineUsers(p.id).then((d) => {
						const v = d && d.ok ? d.value : d;
						const users = v && Array.isArray(v.users) ? v.users : [];
						return [p.id, users];
					}).catch(() => [p.id, []])
				)).then((pairs) => setOnlineMap(Object.fromEntries(pairs)));
			};
			// ★ S3 实时协同：列表页 watch 连接（只收 presence、不算在线）+ 进项目 join 连接（在线）
			const watchSockets = useRef({}); // projectId -> {ws, timer}
			const joinSocket = useRef(null); // 当前进入的项目
			const wsUrl = (pid, watch) => (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/projects/" + pid + "/ws" + (watch ? "?watch=1" : "");
			const wsPing = (ws) => { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "ping" })); } catch { /* ignore */ } };
			const wsPresence = (ev, pid) => {
				try {
					const m = JSON.parse(ev.data);
					if (m.type === "presence" && Array.isArray(m.users)) setOnlineMap((prev) => ({ ...prev, [pid]: m.users }));
				} catch { /* ignore */ }
			};
			const connectWatch = (p) => {
				if (watchSockets.current[p.id] || !p.id) return;
				try {
					const ws = new WebSocket(wsUrl(p.id, true));
					const timer = setInterval(() => wsPing(ws), 30000);
					ws.onmessage = (ev) => wsPresence(ev, p.id);
					ws.onerror = () => {};
					ws.onclose = () => { if (watchSockets.current[p.id]) { clearInterval(timer); delete watchSockets.current[p.id]; } };
					watchSockets.current[p.id] = { ws, timer };
				} catch { /* ignore */ }
			};
			const connectJoin = (p) => {
				try {
					if (joinSocket.current) { try { joinSocket.current.ws.close(); } catch { /* ignore */ } clearInterval(joinSocket.current.timer); joinSocket.current = null; }
					const ws = new WebSocket(wsUrl(p.id, false));
					const timer = setInterval(() => wsPing(ws), 30000);
					ws.onmessage = (ev) => wsPresence(ev, p.id);
					ws.onerror = () => {};
					ws.onclose = () => { if (joinSocket.current && joinSocket.current.ws === ws) { clearInterval(timer); joinSocket.current = null; } };
					joinSocket.current = { ws, timer, pid: p.id };
				} catch { /* ignore */ }
			};
			const disconnectAllWs = () => {
				Object.values(watchSockets.current).forEach(({ ws, timer }) => { try { clearInterval(timer); ws.close(); } catch { /* ignore */ } });
				watchSockets.current = {};
				if (joinSocket.current) { try { joinSocket.current.ws.close(); } catch { /* ignore */ } clearInterval(joinSocket.current.timer); joinSocket.current = null; }
			};
			const pvUrlFor = (pid) => { const host = (location.host || "").split(".").slice(1).join("."); return host ? "https://pv-" + pid.slice(0, 8) + "." + host : ""; };
			// ★ 一键预览（项目列表版）：检查 → 未启动自动启动 → 就绪后新标签页打开
			const ensureProjectPreview = (p) => {
				if (!window.__madaziSvc || !p || !p.id) return;
				setMenuFor(null);
				const openPv = (v) => window.open((v && v.url) || pvUrlFor(p.id), "_blank"); // ★ 单机 docker：优先服务端 127.0.0.1 URL
				window.__madaziSvc.previewStatus(p.id).then((d) => {
					const v = d && d.ok ? d.value : d;
					if (v && v.running) { openPv(v); return; }
					setStartingPreview(p.id);
					window.__madaziSvc.previewStart(p.id).then((d2) => {
						const v2 = d2 && d2.ok ? d2.value : d2;
						if (v2 && v2.error) { setStartingPreview(null); setError(typeof v2.error === "object" ? JSON.stringify(v2.error) : v2.error); return; }
						const iv = setInterval(() => {
							window.__madaziSvc.previewStatus(p.id).then((d3) => {
								const v3 = d3 && d3.ok ? d3.value : d3;
								if (v3 && v3.running) { clearInterval(iv); setStartingPreview(null); openPv(v3); }
							}).catch(() => {});
						}, 10000);
						setTimeout(() => { clearInterval(iv); setStartingPreview(null); }, 300000); // 5 分钟兜底
					}).catch((e) => { setStartingPreview(null); setError(String((e && e.message) || e)); });
				}).catch((e) => { setStartingPreview(null); setError(String((e && e.message) || e)); });
			};
			const load = () => {
				setProjects(null);
				setError(null);
				// ★ 权限修复：项目/账号/Key 一律同源 cookie 直连（node 半 RPC 是服务身份，会看到所有项目/他人 key）
				madaziFetch("/projects").then((list) => {
					if (list && list.error) { setError(typeof list.error === "object" ? JSON.stringify(list.error) : list.error); return; }
					const arr = Array.isArray(list) ? list : [];
					setProjects(arr);
					projectsRef.current = arr;
					loadOnline(arr);
					arr.forEach(connectWatch);
				}).catch((e) => setError(String((e && e.message) || e)));
				madaziFetch("/auth/me").then((d) => {
					const u = d && !d.error ? (d.user || d) : null;
					if (u && !u.error) setMe(u);
				}).catch(() => {});
				madaziFetch("/keys/usage/summary").then((v) => {
					if (v && !v.error) setUsage(v);
				}).catch(() => {});
			};
			useEffect(() => { load(); }, []);
			// ★ 协同实时：被加进项目 → 项目列表自动重拉（配合全局 WS member_added）
			useEffect(() => {
				const onMemberAdded = () => load();
				if (window.__madaziProjectRefresh) window.__madaziProjectRefresh.push(onMemberAdded);
				return () => {
					const i = window.__madaziProjectRefresh && window.__madaziProjectRefresh.indexOf(onMemberAdded);
					if (i >= 0) window.__madaziProjectRefresh.splice(i, 1);
				};
			}, []);
			// S3 实时同步：在线人数 30s 轮询（WS 失败兜底）
			useEffect(() => {
				const t = setInterval(() => { loadOnline(projectsRef.current); }, 30000);
				return () => clearInterval(t);
			}, []);
			// ★ S3 实时协同：面板挂载即 watch 全部项目（徽标实时），卸载断开全部连接
			useEffect(() => {
				(projectsRef.current || []).forEach(connectWatch);
				return disconnectAllWs;
			}, []);
			const open = async (p) => {
				if (busy) return;
				setBusy(p.id);
				try {
					await onOpenProject(p);
					connectJoin(p); // 进入项目 = 在线（presence 实时广播给项目内在线者）
				} catch (e) {
					window.__madaziLastErr = { phase: "settings.open", msg: String((e && e.message) || e) };
					setError(String((e && e.message) || e));
				} finally {
					setBusy(null);
				}
			};
			const usd = usage && (usage.cost_usd !== undefined && usage.cost_usd !== null ? usage.cost_usd : (usage.total_cost_usd || usage.totalCostUsd || usage.total_cost));
			return h("div", { className: "madazi-settings" },
				h("div", { className: "madazi-settings-hd" },
					h("div", null,
						h("div", { className: "madazi-settings-title" }, "平台"),
						h("div", { className: "madazi-settings-sub" }, "Madazi 账号 · 项目工作区")
					),
					h("button", { className: "madazi-settings-refresh", onClick: load }, "刷新")
				),
				// ── 账号信息 ──
				me ? h("div", { className: "madazi-settings-list" },
					h("div", { className: "madazi-settings-row" },
						h("div", { className: "madazi-settings-row-main" },
							h("div", { className: "madazi-settings-row-n" }, "账号"),
							h("div", { className: "madazi-settings-row-d" }, (me.username || me.email || "—") + (me.role ? " · " + me.role : ""))
						),
						usd !== undefined && usd !== null
							? h("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)", whiteSpace: "nowrap" } }, "用量 $" + (Number(usd) || 0).toFixed(4))
							: null
					)
				) : null,
				// ── 项目 ──
				error
					? h("div", { className: "madazi-pop-d" }, "API: " + error)
					: projects === null
						? h("div", { className: "madazi-pop-d" }, "项目加载中…")
						: projects.length === 0
							? h("div", { className: "madazi-pop-d" }, "暂无项目")
							: h("div", { className: "madazi-settings-list" }, projects.map((p) =>
								h("div", { key: p.id, className: "madazi-settings-row" },
									h("div", { className: "madazi-settings-row-main" },
										h("div", { className: "madazi-settings-row-n" }, p.name || p.title || p.id),
										h("div", { className: "madazi-settings-row-d" }, (p.description || "").slice(0, 60)),
										// ★ S3 实时协同：在线成员显示在项目名称下另起一行（WS presence 实时）
										h("div", { className: "madazi-online-line" + (((onlineMap[p.id] || []).length) ? " on" : ""), title: "在线成员" },
											(onlineMap[p.id] || []).length
												? "● 在线：" + onlineMap[p.id].map((u) => u.username || u.name || u.id).join("、")
												: "○ 暂无成员在线")
									),
									h("div", { style: { position: "relative", display: "flex", gap: 6, alignItems: "center" } },
										h("button", { className: "madazi-settings-open", onClick: () => open(p), disabled: !!busy },
											busy === p.id ? "打开中…" : "打开"),
										h("button", { className: "madazi-settings-open", onClick: () => setMenuFor(menuFor === p.id ? null : p.id), title: "更多操作" }, "⋯"),
										menuFor === p.id ? h("div", { className: "madazi-menu" },
										h("div", { className: "madazi-menu-item", onClick: () => { setMenuFor(null); setMembersProject(p); } }, "管理项目成员"),
										h("div", { className: "madazi-menu-item", onClick: () => ensureProjectPreview(p) },
											startingPreview === p.id ? "预览启动中…" : "预览"),
										h("div", { className: "madazi-menu-item", onClick: () => { setMenuFor(null); setPublishProject(p); } }, "发布为模板")
									) : null
									)
								)
							))
					,
					membersProject
					? h(MembersModal, { project: membersProject, me, onClose: () => setMembersProject(null) })
					: null,
				// M3：发布为模板向导
				publishProject
					? h(PublishTemplateModal, { project: publishProject, onClose: () => setPublishProject(null) })
					: null
				);
		};

// ═══════════════════════════════════════════════════════════════
// src/07-admin.js
// ═══════════════════════════════════════════════════════════════
		/** Admin section in the settings panel (P4, admin only): user roster
		 * (create / role change / delete) + all platform keys (revoke). */
		const AdminSection = ({ close, onOpenProject }) => {
			// 管理 tab 内子 tab：users（用户管理）/ keys（三方登录）/ userkeys（用户 Key）/ system（系统设置）
			const [tab, setTab] = useState("users");
			// 用户管理：添加用户弹窗开关（点「＋」弹出，不默认展示表单）
			const [addOpen, setAddOpen] = useState(false);
			// 用户管理：重置密码弹窗（管理员给指定用户设新密码）
			const [pwdUser, setPwdUser] = useState(null); // 正在重置密码的用户（null = 关闭）
			const [nPwd, setNPwd] = useState("");
			const [pwdErr, setPwdErr] = useState(null);
			const [pwdBusy, setPwdBusy] = useState(false);
			// 用户 Key：签发时绑定到哪个用户（key 泄露场景：吊销旧 key → 选该用户签发新 key）
			const [issueUser, setIssueUser] = useState("");
			const [users, setUsers] = useState(null);
			const [keys, setKeys] = useState(null);
			const [error, setError] = useState(null);
			const [msg, setMsg] = useState(null);
			// Key 与登录：签发新 key（POST /keys）
			const [kErr, setKErr] = useState(null);
			const [kOk, setKOk] = useState(null);
			const [newKey, setNewKey] = useState(null);
			const [kBusy, setKBusy] = useState(false);
			// 预览回收设置（GET/PUT /admin/settings，server 侧白名单 preview_idle_timeout）
			const [idleHours, setIdleHours] = useState("");
			const [idleBusy, setIdleBusy] = useState(false);
			const [idleMsg, setIdleMsg] = useState(null);
			const loadIdle = () => {
				madaziFetch("/admin/settings").then((v) => {
					if (v && !v.error && v.preview_idle_timeout !== undefined) {
						const h = Number(v.preview_idle_timeout) / 3600;
						setIdleHours(String(Math.round(h * 100) / 100));
					}
				}).catch(() => {});
			};
			const saveIdle = async () => {
				const hNum = Number(idleHours);
				if (!Number.isFinite(hNum) || hNum < 0) { setIdleMsg("请输入非负数字（小时，0 = 不回收）"); return; }
				setIdleBusy(true); setIdleMsg(null);
				try {
					const v = await madaziFetch("/admin/settings", { method: "PUT", body: JSON.stringify({ settings: { preview_idle_timeout: String(Math.round(hNum * 3600)) } }) });
					if (v && v.error) { setIdleMsg("保存失败：" + (typeof v.error === "object" ? JSON.stringify(v.error) : v.error)); return; }
					setIdleMsg("已保存：闲置 " + hNum + " 小时后自动停止预览" + (hNum === 0 ? "（已关闭回收）" : ""));
				} catch (e) { setIdleMsg(String((e && e.message) || e)); }
				finally { setIdleBusy(false); }
			};
			const [busy, setBusy] = useState(false);
			// create-user form
			const [nU, setNU] = useState("");
			const [nP, setNP] = useState("");
			const [nR, setNR] = useState("user");
			const [nErr, setNErr] = useState(null);
			// M4 模板审核：待审队列 + 展开详情 + 驳回 reason
			const [pending, setPending] = useState(null);
			const [pendErr, setPendErr] = useState(null);
			const [pendBusy, setPendBusy] = useState(null); // 审核操作中的 version_id
			const [readmeFor, setReadmeFor] = useState(null); // 展开 README 的 version_id
			const [readme, setReadme] = useState(null);
			const [rejectFor, setRejectFor] = useState(null); // 驳回输入中的 version_id
			const [rejectReason, setRejectReason] = useState("");
			const loadPending = () => {
				setPendErr(null);
				madaziFetch("/admin/market/pending").then((v) => {
					if (v && v.error) { setPendErr(v.error); return; }
					setPending(Array.isArray(v) ? v : []);
				}).catch((e) => setPendErr(String((e && e.message) || e)));
			};
			const toggleReadme = (item) => {
				if (readmeFor === item.version_id) { setReadmeFor(null); setReadme(null); return; }
				setReadmeFor(item.version_id); setReadme(null);
				madaziFetch("/market/templates/" + encodeURIComponent(item.slug)).then((d) => {
					setReadme(d && d.readme ? d.readme : "（无 README）");
				}).catch(() => setReadme("（读取失败）"));
			};
			const review = async (item, approved) => {
				if (pendBusy) return;
				if (approved && !window.confirm(`批准「${item.name} v${item.version}」上架？`)) return;
				setPendBusy(item.version_id);
				setPendErr(null);
				try {
					const v = await madaziFetch(`/admin/market/templates/${item.id}/versions/${item.version_id}/${approved ? "approve" : "reject"}`,
						approved ? { method: "POST" } : { method: "POST", body: JSON.stringify({ reason: rejectReason.trim() }) });
					if (v && v.error) { setPendErr(v.error); return; }
					setMsg(approved ? `已批准 ${item.name} v${item.version}` : `已驳回 ${item.name} v${item.version}`);
					setRejectFor(null); setRejectReason(""); setReadmeFor(null);
					loadPending();
				} catch (e) {
					setPendErr(String((e && e.message) || e));
				} finally {
					setPendBusy(null);
				}
			};
			const load = () => {
				setError(null);
				// ★ 2026-09-13 改浏览器同源 cookie 直连（与平台面板同模式）：bridge RPC 走
				//   node 半无服务令牌 → server 401 → 前端报 gateway/internal。直连避免鉴权断层。
				madaziFetch("/admin/users").then((v) => {
					if (v && v.error) { setError(typeof v.error === "object" ? JSON.stringify(v.error) : v.error); return; }
					setUsers(Array.isArray(v) ? v : []);
				}).catch((e) => setError(String((e && e.message) || e)));
				madaziFetch("/keys/all").then((v) => {
					if (v && v.error) return;
					setKeys(Array.isArray(v) ? v : []);
				}).catch(() => {});
				loadPending();
			};
			useEffect(() => { load(); loadIdle(); }, []);
			const mkUser = async () => {
				if (busy) return;
				if (!nU.trim() || !nP) { setNErr("用户名与密码必填"); return; }
				setBusy(true);
				setNErr(null);
				setMsg(null);
				try {
					const data = await madaziFetch("/admin/users", { method: "POST", body: JSON.stringify({ username: nU.trim(), password: nP, role: nR }) });
					if (data && data.error) { setNErr(typeof data.error === "object" ? JSON.stringify(data.error) : data.error); return; }
					setMsg("用户已创建");
					setNU(""); setNP("");
					setAddOpen(false); // 创建成功关闭弹窗
					load();
				} catch (e) {
					setNErr(String((e && e.message) || e));
				} finally {
					setBusy(false);
				}
			};
			const chRole = async (id, role) => {
				try {
					const data = await madaziFetch(`/admin/users/${encodeURIComponent(id)}/role`, { method: "PUT", body: JSON.stringify({ role }) });
					if (data && data.error) { setError(typeof data.error === "object" ? JSON.stringify(data.error) : data.error); return; }
					setMsg("角色已更新");
					load();
				} catch (e) { setError(String((e && e.message) || e)); }
			};
			const delUser = async (id) => {
				try {
					const data = await madaziFetch(`/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });
					if (data && data.error) { setError(typeof data.error === "object" ? JSON.stringify(data.error) : data.error); return; }
					setMsg("用户已删除");
					load();
				} catch (e) { setError(String((e && e.message) || e)); }
			};
			// 重置密码（管理员给指定用户设新密码）：直连 server（同源 cookie，adminOnly），
			// PUT /admin/users/:id/password（后端已存在）
			const resetPwd = async () => {
				if (pwdBusy || !pwdUser) return;
				if (!nPwd || nPwd.length < 6) { setPwdErr("密码至少 6 位"); return; }
				setPwdBusy(true); setPwdErr(null);
				try {
					const v = await madaziFetch("/admin/users/" + encodeURIComponent(pwdUser.id) + "/password", { method: "PUT", body: JSON.stringify({ password: nPwd }) });
					if (v && v.error) { setPwdErr(typeof v.error === "object" ? JSON.stringify(v.error) : v.error); return; }
					setMsg("已重置 " + (pwdUser.username || pwdUser.id) + " 的密码");
					setPwdUser(null); setNPwd("");
				} catch (e) {
					setPwdErr(String((e && e.message) || e));
				} finally {
					setPwdBusy(false);
				}
			};
			const revoke = async (id) => {
				try {
					const data = await madaziFetch(`/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
					if (data && data.error) { setError(typeof data.error === "object" ? JSON.stringify(data.error) : data.error); return; }
					setMsg("key 已吊销");
					load();
				} catch (e) { setError(String((e && e.message) || e)); }
			};
			// ★ 签发新 key（原平台 tab 的 API Keys 入口，合并到管理 → Key 与登录）
			const mkKey = async () => {
				if (kBusy) return;
				setKBusy(true);
				setKErr(null);
				setKOk(null);
				setNewKey(null);
				try {
					// admin 签发可绑定到指定用户（userId）；未选则签给自己
					const body = { name: "dsh 客户端" };
					if (issueUser) body.userId = issueUser;
					const k = await madaziFetch("/keys", { method: "POST", body: JSON.stringify(body) });
					if (k && k.error) { setKErr(typeof k.error === "object" ? JSON.stringify(k.error) : k.error); return; }
					setNewKey(k && (k.apiKey || k.key || k.rawKey) ? (k.apiKey || k.key || k.rawKey) : (k && k.key_prefix ? "创建成功：" + k.key_prefix + "***" : "创建成功"));
					setKOk("新 key 已创建");
					load();
				} catch (e) {
					setKErr(String((e && e.message) || e));
				} finally {
					setKBusy(false);
				}
			};
			// 用户 ↔ key 对应（按用户名分组，供「用户 Key」子 tab 展示）
			const groupedKeys = {};
			(keys || []).forEach((k) => {
				const uname = k.username || k.user_id || "未知用户";
				(groupedKeys[uname] = groupedKeys[uname] || []).push(k);
			});
			return h("div", { className: "madazi-settings" },
				h("div", { className: "madazi-settings-hd" },
					h("div", null,
						h("div", { className: "madazi-settings-title" }, "管理"),
						h("div", { className: "madazi-settings-sub" }, "用户 · 三方登录 · 用户 Key · 系统设置（仅管理员）")
					),
					h("button", { className: "madazi-settings-refresh", onClick: () => { load(); loadIdle(); } }, "刷新")
				),
				msg ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-success-primary,#34C759)" } }, msg) : null,
				error ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, "API: " + error) : null,
				// ── 管理内子 tab 导航 ──
				h("div", { className: "madazi-admin-tabs" },
					h("button", { className: "madazi-admin-tab" + (tab === "users" ? " on" : ""), onClick: () => setTab("users") }, "用户管理"),
					h("button", { className: "madazi-admin-tab" + (tab === "keys" ? " on" : ""), onClick: () => setTab("keys") }, "三方登录"),
					h("button", { className: "madazi-admin-tab" + (tab === "userkeys" ? " on" : ""), onClick: () => setTab("userkeys") }, "用户 Key"),
					h("button", { className: "madazi-admin-tab" + (tab === "system" ? " on" : ""), onClick: () => setTab("system") }, "系统设置")
				),
				// ── 系统设置：预览回收（闲置时长）──
				tab === "system" ? h("div", { className: "madazi-form", style: { border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 8 } },
					h("div", { style: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, "预览回收"),
					h("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
						h("input", { className: "madazi-inp", style: { width: 90 }, value: idleHours, inputMode: "decimal", placeholder: "24", onChange: (e) => setIdleHours(e.target.value) }),
						h("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #888)", flex: 1, minWidth: 200 } }, "小时无访问后自动停止预览（0 = 不回收；默认 24）"),
						h("button", { className: "madazi-btn-pri", disabled: idleBusy, onClick: saveIdle }, idleBusy ? "保存中…" : "保存")
					),
					idleMsg ? h("div", { style: { fontSize: 12, color: idleMsg.indexOf("失败") !== -1 || idleMsg.indexOf("请输入") !== -1 ? "var(--dsw-alias-state-error-primary,#FF453A)" : "var(--dsw-alias-state-success-primary,#34C759)" } }, idleMsg) : null
				) : null,
				// ── 三方登录（OAuth 配置，仅管理员）──
				tab === "keys" ? h(OauthSettingsSection, null) : null,
				// ── 用户管理：用户列表 + 添加按钮（点「＋」弹窗添加，不默认展示表单）──
				tab === "users" ? h("div", { className: "madazi-settings-list" },
					h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
						h("div", { style: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, "用户"),
						h("button", { className: "madazi-settings-open", title: "添加用户", onClick: () => { setNErr(null); setAddOpen(true); } }, "＋")
					),
					users === null ? h("div", { className: "madazi-pop-d" }, "加载中…")
						: users.length === 0 ? h("div", { className: "madazi-pop-d" }, "暂无用户")
							: users.map((u) =>
							// ★ 类名用 madazi-admin-user-row（避开 login 插件的 .madazi-user-row
							//   委托监听——否则点击设置面板里的用户行会被误判为「点侧栏用户」，
							//   弹出含「退出登录」的用户菜单）
							h("div", { key: u.id, className: "madazi-admin-user-row" },
								h("div", { style: { minWidth: 0 } },
									h("div", { className: "un" }, u.username || u.email || u.id, " ",
										h("span", { className: "madazi-role-badge" }, u.role || "user")),
									h("div", { className: "meta" }, u.email || u.id)
								),
								h("div", { style: { display: "flex", gap: 6, alignItems: "center" } },
									u.role !== "admin"
										? h("button", { className: "madazi-btn-ghost", style: { padding: "2px 8px" }, onClick: () => chRole(u.id, "admin") }, "设管理员")
										: h("button", { className: "madazi-btn-ghost", style: { padding: "2px 8px" }, onClick: () => chRole(u.id, "user") }, "降为普通"),
									h("button", { className: "madazi-btn-ghost", style: { padding: "2px 8px" }, onClick: () => { setPwdErr(null); setNPwd(""); setPwdUser(u); } }, "重置密码"),
									h("button", { className: "madazi-btn-danger", onClick: () => delUser(u.id) }, "删除")
								)
							)
						)
				) : null,
				// ── 添加用户弹窗 ──
				addOpen ? h(Modal, {
					open: true,
					onClose: () => setAddOpen(false),
					title: "添加用户",
					closeLabel: "关闭",
					footer: h(Button, { variant: "primary", size: "md", disabled: busy, onClick: mkUser }, busy ? "创建中…" : "创建用户"),
					children: h("div", { className: "madazi-form", style: { gap: 10 } },
						h("input", { className: "madazi-inp", value: nU, placeholder: "用户名", onChange: (e) => setNU(e.target.value) }),
						h("input", { className: "madazi-inp", type: "password", value: nP, placeholder: "初始密码", onChange: (e) => setNP(e.target.value) }),
						h("select", { className: "madazi-sel", value: nR, onChange: (e) => setNR(e.target.value) },
							h("option", { value: "user" }, "user"),
							h("option", { value: "admin" }, "admin")
						),
						nErr ? h("div", { className: "madazi-create-err" }, nErr) : null
					)
				}) : null,
				// ── 重置密码弹窗 ──
				pwdUser ? h(Modal, {
					open: true,
					onClose: () => { setPwdUser(null); setNPwd(""); setPwdErr(null); },
					title: "重置密码 · " + (pwdUser.username || pwdUser.id),
					closeLabel: "关闭",
					footer: h(Button, { variant: "primary", size: "md", disabled: pwdBusy, onClick: resetPwd }, pwdBusy ? "重置中…" : "确认重置"),
					children: h("div", { className: "madazi-form", style: { gap: 10 } },
						h("input", { className: "madazi-inp", type: "password", value: nPwd, placeholder: "新密码（至少 6 位）", onChange: (e) => setNPwd(e.target.value) }),
						pwdErr ? h("div", { className: "madazi-create-err" }, pwdErr) : null
					)
				}) : null,
			tab === "userkeys" ? h("div", { className: "madazi-settings-list" },
				h("div", { className: "madazi-settings-row", style: { flexDirection: "column", alignItems: "stretch", gap: 8 } },
					h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
						h("div", { className: "madazi-settings-row-n" }, "签发 API Key"),
						h("button", { className: "madazi-settings-open", disabled: kBusy || !issueUser, onClick: mkKey }, kBusy ? "签发中…" : "＋签发")
					),
					h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
						h("select", { className: "madazi-sel", style: { flex: 1 }, value: issueUser, onChange: (e) => setIssueUser(e.target.value) },
							h("option", { value: "" }, "选择要绑定的用户…"),
							(users || []).map((u) => h("option", { key: u.id, value: u.id }, u.username || u.email || u.id))
						)
					),
					h("div", { style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary, #888)" } }, "key 泄露时：吊销旧 key → 选该用户签发新 key（绑定到该用户名下）"),
					newKey ? h("div", { style: { fontSize: 12, wordBreak: "break-all", padding: "6px 8px", borderRadius: 6, background: "rgba(52,199,89,.1)", color: "var(--dsw-alias-state-success-primary,#34C759)", lineHeight: 1.5 } },
						"新 key（仅此一次可见）：", newKey) : null,
					kOk ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-success-primary,#34C759)" } }, kOk) : null,
					kErr ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, "Key: " + kErr) : null
				)
			) : null,
			// ── 用户 Key：所有用户 ↔ key 对应（吊销 = 控制 key 激活）──
			tab === "userkeys" ? h("div", { className: "madazi-settings-list" },
				h("div", { style: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, "用户与 API Key 对应"),
				h("div", { style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary, #888)" } }, "吊销 = 该 key 立即失效（用户无法再用它调用 AI）；用户重新登录会自动轮换签发新 key"),
				keys === null ? h("div", { className: "madazi-pop-d" }, "加载中…")
					: keys.length === 0 ? h("div", { className: "madazi-pop-d" }, "暂无 key")
						: Object.keys(groupedKeys).map((uname) =>
							h("div", { key: uname, style: { display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 } },
								h("div", { style: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-primary)", marginTop: 4 } }, uname),
								groupedKeys[uname].map((k) =>
									h("div", { key: k.id, className: "madazi-key-row" },
										h("span", { className: "madazi-key-prefix" }, k.key_prefix || k.id),
										h("span", { style: { display: "flex", gap: 6, alignItems: "center" } },
											h("span", { className: "madazi-key-st " + (k.status === "revoked" ? "revoked" : "active") }, k.status === "revoked" ? "已吊销" : "活跃"),
											k.status !== "revoked" ? h("button", { className: "madazi-btn-danger", onClick: () => revoke(k.id) }, "吊销") : null
										)
									)
								)
							)
						)
			) : null,
			// ── 系统设置：模板审核（公开模板发布队列）──
			tab === "system" ? h("div", { className: "madazi-settings-list" },
				h("div", { style: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-primary)", display: "flex", alignItems: "center", gap: 6 } },
					"模板审核",
					pending && pending.length ? h("span", { className: "madazi-badge", style: { minWidth: 18 } }, pending.length) : null),
				pendErr ? h("div", { className: "madazi-pop-d" }, "审核队列: " + pendErr)
					: pending === null ? h("div", { className: "madazi-pop-d" }, "加载中…")
						: pending.length === 0 ? h("div", { className: "madazi-pop-d" }, "暂无待审核模板")
							: pending.map((it) =>
								h("div", { key: it.version_id, className: "madazi-settings-row", style: { flexDirection: "column", alignItems: "stretch", gap: 8 } },
									h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" } },
										h("div", { style: { minWidth: 0 } },
											h("div", { className: "madazi-settings-row-n" },
												it.name || it.slug, " ",
												h("span", { style: { fontSize: 11, color: "var(--dsw-alias-accent-primary,#4c8ffd)" } }, "v" + it.version),
												" ",
												h("span", { className: "madazi-mkt-badge pending" }, "待审核")),
											h("div", { className: "madazi-settings-row-d", style: { maxWidth: "none", whiteSpace: "normal" } },
												it.slug + " · " + (it.author_name || "未知作者") + " · " + (it.category || "fullstack")
												+ " · " + (it.file_count || 0) + " 文件 · " + ((it.pkg_size || 0) / 1024 / 1024).toFixed(2) + " MB"
												+ " · " + mktDate(it.version_created_at) + " 提交"),
											it.changelog ? h("div", { className: "madazi-settings-row-d", style: { maxWidth: "none", whiteSpace: "normal" } }, "更新说明：" + it.changelog) : null,
											Array.isArray(it.tags) && it.tags.length ? h("div", { className: "madazi-mkt-tags", style: { marginTop: 4 } },
												it.tags.map((tag) => h("span", { key: tag }, tag))) : null),
										h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" } },
											h("button", { className: "madazi-btn-ghost", style: { padding: "2px 8px" }, onClick: () => toggleReadme(it) },
												readmeFor === it.version_id ? "收起 README" : "查看 README"),
											h("button", { className: "madazi-settings-open", disabled: !!pendBusy, onClick: () => review(it, true) },
												pendBusy === it.version_id ? "审核中…" : "批准上架"),
											h("button", { className: "madazi-btn-danger", disabled: !!pendBusy, onClick: () => { setRejectFor(rejectFor === it.version_id ? null : it.version_id); setRejectReason(""); } }, "驳回"))
									),
									// 展开 README
									readmeFor === it.version_id ? h("div", { className: "madazi-mkt-readme" },
										readme === null ? "加载中…" : readme) : null,
									// 驳回 reason 输入
									rejectFor === it.version_id ? h("div", { style: { display: "flex", gap: 6, alignItems: "flex-start" } },
										h("textarea", {
											className: "madazi-inp", rows: 2, value: rejectReason,
											placeholder: "驳回原因（将展示给作者）…",
											onChange: (e) => setRejectReason(e.target.value),
										}),
										h("button", { className: "madazi-btn-danger", style: { flex: "none" }, disabled: !!pendBusy, onClick: () => review(it, false) }, "确认驳回")) : null
								)
							)
			) : null
		);

// ═══════════════════════════════════════════════════════════════
// src/08-preview.js
// ═══════════════════════════════════════════════════════════════
		};
		/** S7 插件市场分节（settings.section「插件市场」，仅 admin）：npmmirror 搜索 + 一键安装
		 * （后端 /api/admin/plugins 自动回滚）+ 已装启停/卸载。零 DOM hack；数据层直连同源 API（浏览器 cookie 鉴权）。 */

		const STATUS_LABEL = { queued: "排队中", running: "执行中", success: "完成", failed: "失败", cancelled: "已取消" };
		// ── 日志错误行 → AI 修复（通用机制：任何日志面板报错行都可走这里）──
		const LOG_ERR_RE = /(^|\s)(error|err!|failed|failure|panic|exception|eaddrinuse|cannot find|modulenotfound|command not found|no such file|exit code|npm err|traceback|拒绝|超时)/i;
		// 把日志上下文发进 dsh 原生会话：优先切到该项目 workspace 开新会话，找不到就用当前会话
		const sendLogFixToConversation = (projectId, logLines, hint) => {
			const sessions = _madaziCtx && _madaziCtx.sessions;
			const wsSvc = _madaziCtx && _madaziCtx.workspaces;
			if (!sessions || !sessions.list || typeof sessions.binding !== "function") return false;
			const text = (hint || "预览启动失败，请按 AGENTS.md 运行时契约排查修复（必要时修改 .preview-config.json 或代码）：")
				+ "\n\n【相关日志】\n" + logLines.join("\n").slice(-6000);
			let before;
			try { before = sessions.list.getSnapshot().current; } catch (e) { before = undefined; }
			let wid = null;
			try {
				const items = (wsSvc && wsSvc.list && wsSvc.list.getSnapshot().items) || [];
				const it = items.find((w) => String(w.path || "").indexOf("/generated/" + projectId) !== -1);
				wid = it && (it.workspaceId || it.id);
			} catch (e) { /* ignore */ }
			if (wid && wsSvc && typeof wsSvc.startSession === "function") {
				try { wsSvc.startSession(wid); } catch (e) { /* ignore */ }
			}
			let tries = 0;
			const t = setInterval(() => {
				tries++;
				if (tries > 100) { clearInterval(t); return; }
				try {
					const cur = sessions.list.getSnapshot().current;
					if (!cur) return;
					if (wid && cur === before) return; // 等新会话切到 current
					const bound = sessions.binding(cur);
					if (!bound || !bound.session || typeof bound.session.prompt !== "function") return;
					clearInterval(t);
					bound.session.prompt([{ type: "text", text }], "queue")
						.catch((e) => console.warn("[madazi] log fix prompt failed:", e));
				} catch (e) { /* 未就绪，下轮再试 */ }
			}, 200);
		return true;
	};
	// ★ 桥接：wb-src BrowserView 工具栏/占位页的「AI 修复预览」入口无法访问插件 ctx，经 window 调本函数
	window.__madaziLogFix = (projectId, lines, hint) => sendLogFixToConversation(projectId, lines, hint);
		// 预览日志面板：EventSource 增量流 + 错误行内嵌「AI 修复」+ 失败横幅
		const PreviewLogPane = ({ projectId, active, notRunning }) => {
			const [lines, setLines] = useState([]);
			const [pendFix, setPendFix] = useState(null); // string[] 待确认发送的日志上下文
			const [sent, setSent] = useState(false);
			const rawRef = useRef("");
			const boxRef = useRef(null);
			useEffect(() => {
				if (!active || !projectId) return;
				rawRef.current = "";
				const es = new EventSource("/api/projects/" + projectId + "/preview/log-stream");
				es.onmessage = (ev) => {
					try {
						const m = JSON.parse(ev.data);
						rawRef.current += String(m.text || "");
						if (rawRef.current.length > 300000) rawRef.current = rawRef.current.slice(-200000);
						setLines(rawRef.current.split("\n").slice(-300));
					} catch (e) { /* ignore */ }
				};
				return () => { try { es.close(); } catch (e) { /* ignore */ } };
			}, [active, projectId]);
			useEffect(() => {
				const el = boxRef.current;
				if (el) el.scrollTop = el.scrollHeight;
			}, [lines, pendFix, sent]);
			const errIdxs = [];
			lines.forEach((ln, i) => { if (ln && LOG_ERR_RE.test(ln)) errIdxs.push(i); });
			const errSet = {};
			errIdxs.forEach((i) => { errSet[i] = true; });
			const doSend = () => {
				if (!pendFix || pendFix.length === 0) return;
				if (sendLogFixToConversation(projectId, pendFix)) { setSent(true); setPendFix(null); }
			};
			return h("div", null,
				notRunning && errIdxs.length > 0 && !sent
					? h("div", { className: "madazi-fixbar" },
						h("span", null, "检测到 " + errIdxs.length + " 行错误日志，预览可能启动失败"),
						h("div", { className: "acts" },
							h("button", { className: "madazi-pop-btn primary", onClick: () => setPendFix(lines.slice(Math.max(0, errIdxs[0] - 5))) }, "让 AI 修复")))
					: null,
				sent ? h("div", { style: { fontSize: 11, color: "var(--dsw-alias-state-success-primary,#34C759)", margin: "4px 0" } }, "✓ 已发给 AI，请到对话中查看修复进展") : null,
				h("div", { className: "madazi-logs", ref: boxRef },
					lines.length === 0
						? h("div", { className: "madazi-logline" }, h("span", { className: "lt" }, "等待日志输出…"))
						: lines.map((ln, i) => h("div", { className: "madazi-logline" + (errSet[i] ? " err" : ""), key: i },
							h("span", { className: "lt" }, ln || " "),
							errSet[i] && !sent ? h("button", {
								className: "madazi-logfix", title: "把该行上下文发给 AI 修复",
								onClick: () => setPendFix(lines.slice(Math.max(0, i - 8), Math.min(lines.length, i + 13)))
							}, "AI 修复") : null))),
				pendFix ? h("div", { className: "madazi-fixbar" },
					h("span", null, "发送 " + pendFix.length + " 行日志上下文给 AI 排查修复？"),
					h("div", { className: "acts" },
						h("button", { className: "madazi-pop-btn", onClick: () => setPendFix(null) }, "取消"),
						h("button", { className: "madazi-pop-btn primary", onClick: doSend }, "发送"))) : null
			);
		};
		// ★ 预览：项目级预览（pv-{id前8位}.<平台域> 子域名）；状态打开浮层期间 10s 刷新（构建流程反馈，非协同，轻量轮询）
		const PreviewButton = ({ projectId }) => {
			const [open, setOpen] = useState(false);
			const [st, setSt] = useState(null);
			const [busy, setBusy] = useState(false);
			const [err, setErr] = useState(null);
			const [showFrame, setShowFrame] = useState(false);
			const [waiting, setWaiting] = useState(false);
			const [showLogs, setShowLogs] = useState(false);
			const [startFailed, setStartFailed] = useState(false);
			const waitingRef = useRef(false);
			const waitStartRef = useRef(0);
			const markWaiting = (v) => { waitingRef.current = v; setWaiting(v); if (v) waitStartRef.current = Date.now(); };
			const fetchStatus = () => {
				if (!window.__madaziSvc || !projectId) return;
				window.__madaziSvc.previewStatus(projectId).then((d) => {
					const v = d && d.ok ? d.value : d;
					setSt(v || { running: false });
					if (v && v.running) { setStartFailed(false); if (waitingRef.current) { markWaiting(false); setShowFrame(true); } }
					// 启动失败判定（浏览器侧）：等就绪超 2 分钟 → 给出修复入口
					else if (waitingRef.current && waitStartRef.current && Date.now() - waitStartRef.current > 120000) {
						markWaiting(false); setStartFailed(true); setShowLogs(true);
					}
				}).catch((e) => setErr(String((e && e.message) || e)));
			};
			// ★ 一键预览：检查 → 未启动先启动 → 就绪自动打开；点击即展开日志面板看启动过程
			const ensurePreview = () => {
				if (waitingRef.current || !window.__madaziSvc || !projectId) return;
				setErr(null);
				window.__madaziSvc.previewStatus(projectId).then((d) => {
					const v = d && d.ok ? d.value : d;
					if (v) setSt(v);
					if (v && v.running) { setShowFrame(true); return; }
					markWaiting(true);
					setStartFailed(false);
					setOpen(true);
					setShowLogs(true);
					window.__madaziSvc.previewStart(projectId).then((d2) => {
						const v2 = d2 && d2.ok ? d2.value : d2;
						if (v2 && v2.error) { markWaiting(false); setErr(typeof v2.error === "object" ? JSON.stringify(v2.error) : v2.error); return; }
						setTimeout(() => markWaiting(false), 300000); // 5 分钟兜底
					}).catch((e) => { markWaiting(false); setErr(String((e && e.message) || e)); });
				}).catch((e) => { markWaiting(false); setErr(String((e && e.message) || e)); });
			};
			useEffect(() => {
				if (!open || !projectId) return;
				fetchStatus();
				const t = setInterval(fetchStatus, 10000);
				return () => clearInterval(t);
			}, [open, projectId]);
			const act = (fn) => {
				if (busy) return;
				setBusy(true); setErr(null);
				fn().then((d) => {
					const v = d && d.ok ? d.value : d;
					if (v && v.error) { setErr(typeof v.error === "object" ? JSON.stringify(v.error) : v.error); return; }
					fetchStatus();
				}).catch((e) => setErr(String((e && e.message) || e))).finally(() => setBusy(false));
			};
			if (!projectId) return null;
			const running = !!(st && st.running);
			const statusText = !st ? "查询中…"
				: st.status === "ready" ? "就绪"
					: st.status === "building" ? "构建中…"
						: st.status === "starting" ? "启动中…"
							: st.status === "stopped" ? "已停止"
								: running ? "运行中" : "未启动";
			const host = (location.host || "").split(".").slice(1).join(".");
			// ★ 单机 docker 模式：服务端 status 返回 http://127.0.0.1:<port>/ 直连 URL（优先）；
			//   K8s 模式服务端返回 pv- 子域名，二者与本地拼退路一致，未就绪时 st.url 为空回落旧逻辑
			const pvUrl = (st && st.url) || (host ? "https://pv-" + projectId.slice(0, 8) + "." + host : "");
			return h("div", { style: { position: "relative", display: "inline-block" } },
				h("button", { className: "madazi-taskbtn", onClick: ensurePreview, title: "预览：检查→未启动自动启动→就绪自动打开" },
					h("span", null, waiting ? "启动中…" : "预览"),
					(waiting || running) ? h("span", { className: "madazi-badge" + (running ? " on" : "") }, waiting ? "…" : "●") : null
				),
				open && h("div", { className: "madazi-pop madazi-prevpop" },
					h("div", { className: "madazi-pop-hd" },
						h("span", null, "预览"),
						h("span", { style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary)" } }, projectId ? projectId.slice(0, 8) : "")
					),
					h("div", { className: "madazi-pop-d" },
						err ? h("div", { className: "madazi-err" }, String(err)) : null,
						h("div", { className: "madazi-prev-status" + (running ? " on" : "") }, statusText),
						startFailed && !running
							? h("div", { className: "madazi-fixbar" },
								h("span", null, "启动超过 2 分钟未就绪，可能失败了"),
								h("div", { className: "acts" },
									h("button", { className: "madazi-pop-btn primary", onClick: () => setShowLogs(true) }, "查看日志 / 让 AI 修复")))
							: null,
						running || (st && st.stopped)
							? h("div", { className: "madazi-prev-acts" },
								pvUrl && running ? h("button", { className: "madazi-pop-btn primary", onClick: () => setShowFrame(!showFrame) }, showFrame ? "收起预览" : "打开预览") : null,
								pvUrl && running ? h("button", { className: "madazi-pop-btn", onClick: () => window.open(pvUrl, "_blank") }, "新标签") : null,
								h("button", { className: "madazi-pop-btn danger", disabled: busy, onClick: () => act(() => window.__madaziSvc.previewStop(projectId)) }, "停止")
							)
							: h("button", { className: "madazi-pop-btn primary", disabled: busy, onClick: () => act(() => window.__madaziSvc.previewStart(projectId)) }, busy ? "操作中…" : "启动预览"),
						running && pvUrl ? h("div", { className: "madazi-prev-url", title: pvUrl },
							h("span", { className: "madazi-prev-url-lbl" }, "预览地址"),
							h("code", null, pvUrl),
							h("button", { className: "madazi-btn-ghost", style: { padding: "2px 8px", fontSize: 11 }, onClick: () => { try { navigator.clipboard.writeText(pvUrl); } catch { /* ignore */ } } }, "复制")
						) : null,
						h("div", { className: "madazi-loghd", onClick: () => setShowLogs(!showLogs) },
							h("span", null, (showLogs ? "▾ " : "▸ ") + "启动日志"),
							waiting && !running ? h("span", { style: { color: "var(--dsw-alias-accent-primary,#4c8ffd)" } }, "实时输出中…") : null
						),
						showLogs ? h(PreviewLogPane, { projectId, active: open && showLogs, notRunning: !running }) : null,
						running && showFrame && pvUrl ? h("iframe", { className: "madazi-prev-frame", src: pvUrl, title: "预览", sandbox: "allow-scripts allow-same-origin allow-forms allow-popups" }) : null
					)
				)
			);
		};

// ═══════════════════════════════════════════════════════════════
// src/10-fetch-online.js
// ═══════════════════════════════════════════════════════════════
		// ── S3 hero 行：sidebar 项目分组标题行下方注入 创建人头像+名称+成员头像+加号（管理成员）。
		//    官方 dsh-client-ui-workspace 无行级 slot → 用 MutationObserver 做 DOM 增强，官方 bundle 零修改。
		//    数据：listProjects 按行标题(workspace.title=项目名)匹配 → listProjectMembers/getMe → 渲染子行。
		const madaziFetch = async (path, opts) => {
			try {
				const r = await fetch("/api" + path, Object.assign({ credentials: "same-origin", headers: { "Content-Type": "application/json" } }, opts || {}));
				const j = await r.json().catch(() => null);
				if (!r.ok) return { error: (j && j.error) || ("HTTP " + r.status) };
				return j;
			} catch (e) { return { error: String((e && e.message) || e) }; }
		};
		// ★ 工作区真实路径解析（2026-09-12 去硬编码化）：server 按部署形态唯一推导
		//   （k8s=/app/generated/...；单机版=注入的 PROJECTS_ROOT/...），经 B12 安全专用接口
		//   GET /api/projects/:id/workspace-path（挂 projectAccess）下发，前端不再拼 /app/generated
		//   或开发机绝对路径。返回绝对路径；失败（无权限/网络）返回 null。
		if (!window.__madaziResolveWorkspacePath) {
			window.__madaziResolveWorkspacePath = async (projectId) => {
				try {
					if (!projectId) return null;
					const d = await madaziFetch(`/projects/${encodeURIComponent(projectId)}/workspace-path`);
					return (d && d.path) || null;
				} catch { return null; }
			};
		}
		// 全局在线订阅：一个 WS 收所有项目 presence（sidebar 子行实时在线，零轮询）
		const _onlineMap = {};
		let _globalOnline = []; // 全局在线集合（登录即在线；后端广播 scope:'global'）
		const _onlineSubs = new Set();
		let _onlineWs = null;
		// ★ 项目实时刷新回调（被加进项目 → 项目弹窗/设置分节自动重拉）：[] of cb(info)
		if (!window.__madaziProjectRefresh) window.__madaziProjectRefresh = [];
		// ★ 被加进项目 → 自动创建 workspace（侧栏立即出现该项目行）+ rename 项目名。
//   返回 true=本次新增注册；false=已存在/跳过（供 adopt-all 统计）
const _autoAdoptProject = async (info) => {
	try {
		const ctx = _madaziCtx;
		const wsSvc = ctx && ctx.workspaces;
		if (!wsSvc || typeof wsSvc.create !== "function" || !info || !info.projectId) return false;
		// ★ 真实路径由 server 推导（B12 专用接口），不再硬编码 /app/generated 或开发机路径
		const path = await window.__madaziResolveWorkspacePath(info.projectId);
		if (!path) { console.warn("[madazi] resolve workspace path failed:", info.projectId); return false; }
		// 已存在 workspace 则跳过（幂等）
		try {
			const snap = wsSvc.list && wsSvc.list.getSnapshot();
			const items = (snap && snap.items) || [];
			if (items.some((w) => w && w.path && String(w.path).replace(/\/+$/, "") === path.replace(/\/+$/, ""))) return false;
		} catch { /* ignore */ }
		const ws = await wsSvc.create({ path });
		const id = ws && (ws.workspaceId || ws.id);
		if (id && info.projectName) { try { await wsSvc.rename(id, info.projectName); } catch { /* 重名冲突等，静默 */ } }
		// 触发侧栏排序重渲染（新 workspace 行及时出现）
		try { window.__madaziApplyOrder && window.__madaziApplyOrder(); } catch { /* ignore */ }
		console.log("[madazi] auto-adopted project workspace:", info.projectId, info.projectName);
		return !!id;
	} catch (e) { console.warn("[madazi] auto-adopt workspace failed:", String((e && e.message) || e)); return false; }
};
// ★ 全量铺陈（登录后）：把平台全部项目注册为侧栏工作区，让「项目列表」= 全部项目而非仅打开过的。
//   复用 _autoAdoptProject 的幂等（resolve path + 已存在跳过），只登记不自动开会话；
//   draft（未生成，无 source_path）经 workspace-path 解析失败自动跳过。
const _adoptAllProjects = async () => {
	try {
		const ctx = _madaziCtx;
		const wsSvc = ctx && ctx.workspaces;
		if (!wsSvc || typeof wsSvc.create !== "function") return;
		const list = await madaziFetch("/projects");
		const arr = Array.isArray(list) ? list : [];
		let adopted = 0;
		for (const p of arr) {
			if (!p || !p.id) continue;
			if (await _autoAdoptProject({ projectId: p.id, projectName: p.name || null })) adopted++;
		}
		console.log(`[madazi] adopt-all projects: ${arr.length} total, ${adopted} newly adopted`);
	} catch (e) { console.warn("[madazi] adopt-all failed:", String((e && e.message) || e)); }
};
if (!window.__madaziAdoptAll) window.__madaziAdoptAll = _adoptAllProjects;
// ★ 空态自愈：官方 settings/models 页签或 onboarding 会触发 epoch/_reload 全局刷新，
//   workspace store 重建为空的瞬间侧栏「项目列表」闪没，且官方无空态重拉 → 看似永久消失。
//   订阅官方 workspace store：检测「非空 → 变空（且未在首轮就绪前误判）」立即幂等重铺回填。
let _wsListPrevCount = -1; // -1=未初始化（跳过首帧，避免把首轮加载也当“被清空”）
const _watchWorkspaceEmptiness = () => {
	try {
		const ctx = _madaziCtx;
		const wsSvc = ctx && ctx.workspaces;
		if (!wsSvc || !wsSvc.list || typeof wsSvc.list.subscribe !== "function") { setTimeout(_watchWorkspaceEmptiness, 2000); return; }
		let debounce = null;
		wsSvc.list.subscribe(() => {
			try {
				const snap = wsSvc.list.getSnapshot();
				const items = (snap && snap.items) || [];
				const n = items.length;
				if (_wsListPrevCount > 0 && n === 0) {
					// 非空 → 空：官方 store 重载清空，立即回填（防抖 1s，避免紧跟的二次清空风暴）
					if (!debounce) {
						debounce = setTimeout(() => {
							debounce = null;
							console.warn("[madazi] workspace list cleared (官方 store reload)，触发回填");
							window.__madaziAdoptAll && window.__madaziAdoptAll();
						}, 1000);
					}
				} else if (n > 0) {
					debounce = null; // 有数据了，取消悬空回填
				}
				_wsListPrevCount = n;
			} catch { /* ignore */ }
		});
		console.log("[madazi] workspace emptiness watch started");
	} catch (e) { console.warn("[madazi] emptiness watch failed:", e); }
};
window.__madaziWatchEmptiness = _watchWorkspaceEmptiness;
		const _startGlobalOnlineWS = () => {
			if (_onlineWs) return;
			try {
				const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/ws/presence");
				_onlineWs = ws;
				ws.onmessage = (ev) => {
					try {
						const m = JSON.parse(ev.data);
						if (m && m.type === "presence" && m.projectId) {
							_onlineMap[m.projectId] = Array.isArray(m.users) ? m.users : [];
							for (const cb of _onlineSubs) cb(m.projectId);
						}
						// 全局在线（登录即在线）：所有子行重算 成员∩全局在线
						if (m && m.type === "presence" && m.scope === "global" && Array.isArray(m.users)) {
							_globalOnline = m.users;
							for (const cb of _onlineSubs) cb("__global__");
						}
						// ★ 协同实时：被加进项目 → 自动创建 workspace + 通知项目列表刷新
						if (m && m.type === "member_added") {
							_autoAdoptProject(m);
							// 清未分组会话过滤标记并重扫（被加进项目后历史会话恢复显示）
							try { window.__madaziUngroupedRescan && window.__madaziUngroupedRescan(); } catch { /* ignore */ }
							for (const cb of window.__madaziProjectRefresh) { try { cb(m); } catch { /* ignore */ } }
						}
						// ★ 协同实时：新项目 → 刷新项目列表 + membership 成员表（管理员/成员即时看到，
						//   gate 立即放行新项目，无需等 30s 轮询）
						if (m && m.type === "project_created") {
							try { if (window.__madaziMembershipRefresh) window.__madaziMembershipRefresh(); } catch { /* ignore */ }
							for (const cb of window.__madaziProjectRefresh) { try { cb(m); } catch { /* ignore */ } }
						}
					} catch {}
				};
				ws.onclose = () => {
					_onlineWs = null;
					// ★ 已登出（login 插件置 __madaziLoggedIn=false）不再重连，避免登出后 401 刷屏；
					//   undefined（标志未初始化的老路径）保持原重连行为
					if (window.__madaziLoggedIn === false) return;
					setTimeout(_startGlobalOnlineWS, 5000);
				};
				ws.onerror = () => { try { ws.close(); } catch {} };
			} catch {}
		};
		const _subscribeOnline = (projectId, cb) => {
			_onlineSubs.add(cb);
			return () => { _onlineSubs.delete(cb); };
		};
		const escHtml = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
	const letterOf = (n) => (n && n[0] ? n[0] : "?").toUpperCase();
	// ★ 侧栏 section 标题「工作区」→「项目列表」DOM 兜底（字典合并若晚于首渲染，locale 不触发重渲染）
	const _startSectionLabelPatch = () => {
		if (window.__madaziSecLabelStarted) return;
		window.__madaziSecLabelStarted = true;
		const MAP = { "工作区": "项目列表", "Workspaces": "Projects" };
		const scan = () => {
			const els = document.querySelectorAll(".qDHVXG_sectionLabel");
			for (const el of els) {
				const txt = (el.textContent || "").trim();
				if (MAP[txt] && el.textContent !== MAP[txt]) el.textContent = MAP[txt];
			}
		};
		scan();
		const mo = new MutationObserver(() => scan());
		mo.observe(document.body, { childList: true, subtree: true, characterData: true });
	};
	const startRowMeta = () => {
			if (window.__madaziRowMetaStarted) return;
			window.__madaziRowMetaStarted = true;
			const scan = () => {
				if (!window.__madaziSvc) return;
				const rows = document.querySelectorAll('[role="treeitem"]');
				for (const row of rows) {
					const c0 = row.children && row.children[0];
					// workspace 分组行特征：首子元素含 folder 图标 svg + aria-expanded 属性
					if (!c0 || !c0.querySelector || !c0.querySelector("svg") || row.getAttribute("aria-expanded") === null) continue;
					const pt = row.children && row.children[2];
					const titleEl = pt && pt.querySelector ? pt.querySelector("span") : null;
					const label = ((titleEl ? titleEl.textContent : (pt ? pt.textContent : "")) || "").trim();
					if (!label) continue;
					// ★ 标题还是 uuid（官方 create 不设标题，新工作区标题=path 末段 uuid，
					//   改名守护随后才异步改成项目名）：此刻按名字查项目必落空，绝不可按
					//   「非成员」隐藏行。跳过且不打 done 标记，等改名引发 DOM 变更后重扫。
					if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(label)) continue;
					// ★ 标题变化（uuid→项目名、官方改名）→ 重新处理（injectMeta 内解除误隐藏）
					if (row.dataset && row.dataset.madaziMetaDone && row.dataset.madaziMetaLabel === label) continue;
					row.dataset.madaziMetaDone = "1";
					row.dataset.madaziMetaLabel = label;
					injectMeta(row, label);
				}
			};
			scan();
			const mo = new MutationObserver(() => scan());
			mo.observe(document.body, { childList: true, subtree: true, characterData: true });
		};

// ═══════════════════════════════════════════════════════════════
// src/11-members-overlay.js
// ═══════════════════════════════════════════════════════════════
		const injectMeta = (row, label) => {
			// 重扫到的行可能带着上次「非成员误隐藏」的 display:none（如 uuid 标题期被藏）→ 先解除
			row.style.display = "";
			// 官方行是 flex nowrap：子行要另起一行必须允许 wrap
			row.style.flexWrap = "wrap";
			row.style.height = "auto";
			// ★ 会话行跟随项目行显示/隐藏：项目行之后、下一个项目行之前的兄弟 treeitem 即本项目会话行。
			//   非成员项目 → 隐藏项目行 + 会话行（杜绝「看到其他项目会话但不知归属」）；
			//   成员项目 → 恢复历史隐藏的会话行（被加进项目后重扫自动恢复）。
			const setSectionHidden = (hide) => {
				for (let el = row.nextElementSibling; el; el = el.nextElementSibling) {
					if (el.getAttribute && el.getAttribute("role") === "treeitem" && el.getAttribute("aria-expanded") !== null) break;
					if (hide) { el.style.display = "none"; if (el.dataset) el.dataset.madaziMemberHidden = "1"; }
					else if (el.dataset && el.dataset.madaziMemberHidden) { el.style.display = ""; delete el.dataset.madaziMemberHidden; }
				}
			};
			const sub = document.createElement("div");
			sub.className = "madazi-ws-subrow";
			sub.innerHTML = '<span class="madazi-ws-loading">…</span>';
			sub.addEventListener("click", (e) => e.stopPropagation());
			row.appendChild(sub);
			const fail = () => { sub.remove(); if (row.dataset) row.dataset.madaziMetaDone = ""; };
			madaziFetch("/projects").then((list) => {
				const projects = Array.isArray(list) ? list : [];
				// ★ 项目归属按 workspace 路径解析，绝不因「标题≠项目名」误藏分组行：
				//   侧栏「项目重命名」只改 dsh 工作区标题（workspace.title），项目名
				//   （projects.name）不变 → 旧按 name 匹配在改名后必然失败 → 分组行被
				//   display:none 整组藏起来（本 bug）。身份锚点应是 path 里的 projectId，
				//   path 在重命名/刷新均不变；成员可见性已由更可靠的
				//   __madaziGatedWorkspaces 路径门禁负责，这里不再按名字隐藏。
				const svc = window.__madaziWs || (_madaziCtx && _madaziCtx.workspaces);
				const snap = (svc && svc.list && typeof svc.list.getSnapshot === "function") ? svc.list.getSnapshot() : null;
				const wsItems = (snap && snap.items) || [];
				const ws = wsItems.find((w) => w && w.title === label);
				const wsPath = (ws && typeof ws.path === "string" ? ws.path : "").replace(/\/+$/, "");
				const pathPid = wsPath ? (wsPath.split("/").pop() || "") : "";
				const p = (pathPid && projects.find((x) => x && x.id === pathPid))
					|| projects.find((x) => x && x.name === label); // 非平台路径工作区兜底按名匹配
				if (!p) {
					// 请求失败/异常，或确非本用户可见项目：仅移除加载子行，不隐藏分组行
					if (!Array.isArray(list)) { fail(); return null; }
					fail();
					return null;
				}
				row.dataset.madaziMember = "1"; // ★ 成员项目
				setSectionHidden(false); // ★ 成员项目：恢复该组会话行显示
				row.dataset.madaziProjectId = p.id;
				return Promise.all([madaziFetch("/projects/" + p.id + "/members"), madaziFetch("/auth/me")]).then(([mv, mev]) => {
					if (!mv || !mv.owner) { fail(); return null; }
					sub.innerHTML = "";
					const owner = mv.owner;
					const ownerEl = document.createElement("span");
				ownerEl.className = "madazi-ws-owner";
				ownerEl.title = "创建人 " + (owner.username || "");
				const av = document.createElement("span");
				av.className = "madazi-ws-avatar";
				av.style.background = avatarBg(owner.username);
				av.textContent = letterOf(owner.username);
					const nm = document.createElement("span");
					nm.className = "madazi-ws-owner-name";
					nm.textContent = owner.username || "";
					ownerEl.appendChild(av); ownerEl.appendChild(nm);
					sub.appendChild(ownerEl);
					// 在线成员头像区（只显示在线成员，30s 刷新）
					const avatars = document.createElement("span");
					avatars.className = "madazi-ws-avatars";
					sub.appendChild(avatars);
					const addBtn = document.createElement("button");
					addBtn.className = "madazi-ws-add";
					addBtn.type = "button";
					addBtn.title = "管理项目成员";
					addBtn.textContent = "+";
					addBtn.addEventListener("click", (e) => { e.stopPropagation(); openMembersOverlay(p.id, p.name); });
					sub.appendChild(addBtn);
					const memberList = Array.isArray(mv.members) ? mv.members : [];
					const renderOnline = (users) => {
						const uids = new Set((users || []).map((u) => u && (u.id || u.user_id)));
						const online = memberList.filter((m) => uids.has(m.user_id));
						// 创建人在线 → 绿点
						av.classList.toggle("madazi-ws-online", uids.has(owner.user_id));
						ownerEl.title = "创建人 " + (owner.username || "") + (uids.has(owner.user_id) ? " · 在线" : "");
						avatars.innerHTML = "";
						const shown = online.slice(0, 6);
					for (const mb of shown) {
						const a = document.createElement("span");
						a.className = "madazi-ws-mavatar madazi-ws-online";
						a.style.background = avatarBg(mb.username);
						a.title = (mb.username || "") + " · 在线" + (mb.role === "admin" ? " · 项目管理员" : "");
						a.textContent = letterOf(mb.username);
						avatars.appendChild(a);
					}
						if (online.length > 6) {
							const more = document.createElement("span");
							more.className = "madazi-ws-mavatar madazi-ws-more";
							more.title = "共 " + online.length + " 名成员在线";
							more.textContent = "+" + (online.length - 6);
							avatars.appendChild(more);
						}
						if (!online.length) avatars.style.display = "none"; else avatars.style.display = "";
					};
					// 登录即在线：渲染 成员 ∩ 全局在线（首帧可能为空，WS 连接后立即全量广播）
					renderOnline(_globalOnline);
					const unsub = _subscribeOnline("__g__", () => {
						if (!row.isConnected) { unsub(); return; }
						renderOnline(_globalOnline);
					});
					return null;
				});
			}).catch(() => { fail(); });
		};
		// DOM 版成员管理浮层（sidebar 行加号用；React 版 MembersModal 服务于项目列表 ⋯ 菜单）
		const openMembersOverlay = (projectId, projectName) => {
			if (document.querySelector(".madazi-members-overlay")) return;
			const ov = document.createElement("div");
			ov.className = "madazi-members-overlay";
			ov.innerHTML =
				'<div class="madazi-members-dialog">' +
				'<div class="madazi-members-hd"><span>管理项目成员 · ' + escHtml(projectName) + '</span><button type="button" class="madazi-members-close">✕</button></div>' +
				'<div class="madazi-members-body"><div class="madazi-members-load">加载中…</div></div>' +
				'<div class="madazi-members-foot">' +
					'<div class="madazi-members-roles">' +
						'<button type="button" class="madazi-role-btn" data-role="admin">设为管理员</button>' +
						'<button type="button" class="madazi-role-btn on" data-role="developer">设为开发者</button>' +
					'</div>' +
					'<input class="madazi-members-q" placeholder="按用户名搜索添加成员…" autocomplete="off" />' +
					'<div class="madazi-members-results"></div>' +
				'</div>' +
				'</div>';
			document.body.appendChild(ov);
			const close = () => ov.remove();
			ov.querySelector(".madazi-members-close").addEventListener("click", close);
			ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
			// ★ 添加成员角色选择（默认开发者；高亮当前选中）
			let addRole = "developer";
			ov.querySelectorAll(".madazi-role-btn").forEach((b) => {
				b.addEventListener("click", () => {
					addRole = b.dataset.role;
					ov.querySelectorAll(".madazi-role-btn").forEach((x) => x.classList.toggle("on", x === b));
				});
			});
			const body = ov.querySelector(".madazi-members-body");
			const q = ov.querySelector(".madazi-members-q");
			const results = ov.querySelector(".madazi-members-results");
			let mev = null;
			let data = null;
			const render = () => {
				if (!data) return;
				const meu = mev && (mev.user || mev); // /auth/me 返回 {user}
				const meId = meu && (meu.id || meu.user_id);
				const members = data.members || [];
				const canManage = !!meId && (data.owner.user_id === meId || (meu && meu.role === "admin") || members.some((x) => x.user_id === meId && x.role === "admin"));
				// ★ 移除权限收紧：仅创建人 + 平台管理员可移除；项目管理员可加人/改角色但不能移除
				const canRemove = !!meId && (data.owner.user_id === meId || (meu && meu.role === "admin"));
				const dot = (uid) => "";
				let html = '<div class="madazi-user-row"><div style="display:flex;gap:8px;align-items:center"><span class="madazi-dot"></span><span class="un">' + escHtml(data.owner.username) + '</span><span class="madazi-role-badge">创建人</span></div><span class="meta">创建人</span></div>';
				html += members.map((m) =>
					'<div class="madazi-user-row"><div style="display:flex;gap:8px;align-items:center"><span class="madazi-dot"></span><span class="un">' + escHtml(m.username) + '</span><span class="madazi-role-badge">' + (m.role === "admin" ? "项目管理员" : "开发者") + "</span></div>" +
					(canManage && m.user_id !== data.owner.user_id
						? '<span style="display:flex;gap:6px;align-items:center">' +
							'<button type="button" class="madazi-btn-ghost" data-act="role" data-uid="' + m.user_id + '">' + (m.role === "admin" ? "设为开发者" : "设为管理员") + "</button>" +
							(canRemove ? '<button type="button" class="madazi-btn-danger" data-act="rm" data-uid="' + m.user_id + '">移除</button>' : "") + "</span>"
						: '<span class="meta"></span>') +
					"</div>"
				).join("");
				body.innerHTML = html;
				body.querySelectorAll("[data-act]").forEach((btn) => {
				btn.addEventListener("click", (ev) => {
					ev.stopPropagation(); // ★ 防止冒泡到全局捕获监听（误触发用户菜单等）
					const uid = btn.dataset.uid;
					if (btn.dataset.act === "rm") { act(() => madaziFetch("/projects/" + projectId + "/members/" + uid, { method: "DELETE" }), "已移除"); }
					else { act(() => madaziFetch("/projects/" + projectId + "/members/" + uid, { method: "PATCH", body: JSON.stringify({ role: btn.textContent.indexOf("管理员") !== -1 ? "admin" : "developer" }) }), "已更新角色"); }
				});
			});
			};
			const act = (fn, okMsg) => {
				body.innerHTML = '<div class="madazi-members-load">处理中…</div>';
				fn().then((d) => {
					const v = d;
					if (v && v.error) { body.innerHTML = '<div class="madazi-members-load madazi-err">' + escHtml(typeof v.error === "object" ? JSON.stringify(v.error) : v.error) + "</div>"; return; }
					reload();
				}).catch((e) => { body.innerHTML = '<div class="madazi-members-load madazi-err">' + escHtml(String((e && e.message) || e)) + "</div>"; });
			};
			const reload = () => {
				body.innerHTML = '<div class="madazi-members-load">加载中…</div>';
				Promise.all([madaziFetch("/projects/" + projectId + "/members"), madaziFetch("/auth/me")]).then(([m, me]) => {
					data = m;
					mev = me;
					if (!data || !data.owner) { body.innerHTML = '<div class="madazi-members-load madazi-err">加载失败</div>'; return; }
					render();
				}).catch((e) => { body.innerHTML = '<div class="madazi-members-load madazi-err">' + escHtml(String((e && e.message) || e)) + "</div>"; });
			};
			reload();
			let deb = null;
			q.addEventListener("input", () => {
				clearTimeout(deb);
				const t = q.value.trim();
				if (!t) { results.innerHTML = ""; return; }
				deb = setTimeout(() => {
					results.innerHTML = '<div class="madazi-members-load">搜索中…</div>';
					madaziFetch("/projects/" + projectId + "/members/search?q=" + encodeURIComponent(t)).then((d) => {
						const v = d;
						const arr = Array.isArray(v) ? v : [];
						results.innerHTML = arr.length === 0
							? '<div class="madazi-members-load">无匹配用户</div>'
							: arr.map((u) => '<div class="madazi-proj" style="display:flex;justify-content:space-between;align-items:center"><span class="madazi-proj-n">' + escHtml(u.username) + '</span><button type="button" class="madazi-newbtn" style="margin:0;padding:2px 8px">添加</button></div>').join("");
						results.querySelectorAll(".madazi-proj").forEach((rowEl, idx) => {
						rowEl.querySelector("button").addEventListener("click", (ev) => {
							ev.stopPropagation(); // ★ 防冒泡误触发全局监听
							const u = arr[idx];
							rowEl.querySelector("button").disabled = true;
								madaziFetch("/projects/" + projectId + "/members", { method: "POST", body: JSON.stringify({ username: u.username, role: addRole }) }).then((r2) => {
									const v2 = r2 && r2.ok ? r2.value : r2;
									if (v2 && v2.error) { rowEl.querySelector("button").textContent = "失败"; return; }
									rowEl.querySelector("button").textContent = "已添加" + (addRole === "admin" ? "（管理员）" : "（开发者）");
									results.innerHTML = "";
									q.value = "";
									reload();
								}).catch(() => { rowEl.querySelector("button").textContent = "失败"; });
							});
						});
					}).catch(() => { results.innerHTML = '<div class="madazi-members-load madazi-err">搜索失败</div>'; });
				}, 300);
			});
		};

		// ★ 会话可见性「单一裁决器」（2026-08-27 v2，取代一次性标注+被动执法）：
		//   浏览器内存 store 由 WS 推送全量会话（events WS 豁免直达 pod，红线不改），
		//   所以显示层自建权威裁决，语义与 server 数据层拦截一致（fail-closed）：
		//   R1 组作用域：分组头之后、下一个分组头之前的兄弟 treeitem 随组头 madaziMember
		//      三态联动（"1"显示/"0"压制/未标不动防误伤）；React 重渲染冲掉就再压回。
		//   R2 游离行 fail-closed：向前无分组头的会话行必须自证归属（title 精确唯一匹配
		//      byId + cwd 落在成员项目）才显示；blank 本地草稿放行；证明不了的隐藏
		//      （重名/store 未就绪/已移除项目的孤儿历史会话——历史上靠 title 匹配失败
		//      「continue」全漏网，v2 反转为默认隐藏）。
		//   R3 启动遮蔽：首轮裁决前树区 visibility:hidden（不 display:none，布局不跳动），
		//      项目表到手即揭幕；接口 4s 兜底强制揭幕（宁可一瞬闪烁不白屏）。
		const startUngroupedSessionFilter = (ctx) => {
			if (window.__madaziUngroupedFilter) return;
			window.__madaziUngroupedFilter = true;
			// ── R3 启动遮蔽（幂等注入，越早越好）──
			if (!document.getElementById("madazi-boot-veil")) {
				document.documentElement.setAttribute("data-madazi-boot", "1");
				const st = document.createElement("style");
				st.id = "madazi-boot-veil";
				st.textContent = 'html[data-madazi-boot="1"] [role="tree"]{visibility:hidden!important}';
				document.head.appendChild(st);
				setTimeout(() => { document.documentElement.removeAttribute("data-madazi-boot"); }, 4000);
			}
			let projById = null;
			let projAt = 0;
			const loadProjects = () => {
				if (projById && Date.now() - projAt < 30000) return Promise.resolve(projById);
				return madaziFetch("/projects").then((list) => {
					const m = new Map();
					for (const p of Array.isArray(list) ? list : []) m.set(p.id, p);
					projById = m; projAt = Date.now();
					document.documentElement.removeAttribute("data-madazi-boot"); // 项目表到手即揭幕
					return m;
				}).catch(() => { document.documentElement.removeAttribute("data-madazi-boot"); return projById || new Map(); });
			};
			// R1 主扫描：组作用域整组压制/恢复（不依赖 sessions 快照，任何时刻安全执行）
			const enforceGroups = () => {
				const heads = document.querySelectorAll('[role="treeitem"][aria-expanded]');
				for (const head of heads) {
					const ds = head.dataset || {};
					const member = ds.madaziMember === "0" ? false : (ds.madaziMember === "1" || ds.madaziProjectId) ? true : null;
					if (member === null) continue; // 未判定（官方原生行/请求失败）：不动
					for (let el = head.nextElementSibling; el; el = el.nextElementSibling) {
						if (el.getAttribute && el.getAttribute("role") === "treeitem" && el.getAttribute("aria-expanded") !== null) break;
						if (!el.getAttribute || el.getAttribute("role") !== "treeitem") continue;
						if (!member) { if (el.dataset && !el.dataset.madaziMemberHidden) el.dataset.madaziMemberHidden = "1"; el.style.display = "none"; }
						else if (el.dataset && el.dataset.madaziMemberHidden) { delete el.dataset.madaziMemberHidden; el.style.display = ""; }
					}
				}
			};
			// R2 副扫描：游离行 fail-closed（每轮全量复核，身份变化即时恢复/压制）
			const scanOrphans = async () => {
				try {
					const projects = await loadProjects();
					if (!projects.size) return; // 项目表不可用：不执法（fail-open 防全藏白屏）
					const snap = ctx.sessions && ctx.sessions.list && ctx.sessions.list.getSnapshot();
					const byId = (snap && snap.byId) || {};
					for (const row of document.querySelectorAll('[role="treeitem"]')) {
						if (!row.getAttribute || row.getAttribute("aria-expanded") !== null) continue;
						let anchored = false;
						for (let prev = row.previousElementSibling; prev; prev = prev.previousElementSibling) {
							if (prev.getAttribute && prev.getAttribute("role") === "treeitem" && prev.getAttribute("aria-expanded") !== null) { anchored = true; break; }
						}
						if (anchored) continue; // R1 已管
						const isHidden = !!(row.dataset && row.dataset.madaziMemberHidden === "1");
						const ok = (() => {
							const title = (row.textContent || "").trim().slice(0, 64);
							if (!title) return false;
							const all = Object.keys(byId).filter((id) => byId[id] && byId[id].title === title);
							if (all.length !== 1) return false; // 解析不了（重名/未就绪）→ 不放行
							const ent = byId[all[0]];
							if (ent.blank) return true; // blank 本地草稿：用户自己的，放行
							const cwd = typeof ent.cwd === "string" ? ent.cwd.replace(/\/+$/, "") : "";
							const m = cwd.match(/generated\/([0-9a-fA-F-]{36})$/);
							return !!(m && projects.has(m[1]));
						})();
						if (ok) { if (isHidden) { delete row.dataset.madaziMemberHidden; row.style.display = ""; } continue; }
						if (!isHidden) { if (row.dataset) row.dataset.madaziMemberHidden = "1"; row.style.display = "none"; }
					}
				} catch (e) { /* ignore */ }
			};
			let timer = 0;
			const rescan = () => {
				clearTimeout(timer);
				timer = setTimeout(() => { enforceGroups(); scanOrphans().catch(() => {}); }, 60); // 短 debounce：中途推送 ≤1 帧微闪
			};
			// 被加进项目后：全量重扫（恢复历史隐藏的会话）
			window.__madaziUngroupedRescan = rescan;
			try { ctx.sessions && ctx.sessions.list && ctx.sessions.list.subscribe(() => rescan()); } catch (e) { /* ignore */ }
			const mo = new MutationObserver(() => { rescan(); });
			mo.observe(document.body, { childList: true, subtree: true });
			rescan();
		};

		const waitReadyThenOpen = (pid, tryOpen) => {
			let n = 0;
			const iv = setInterval(() => {
				n++;
				window.__madaziSvc.previewStatus(pid).then((d) => {
					const v = d && d.ok ? d.value : d;
					if (v && (v.running || v.status === "running")) { clearInterval(iv); tryOpen(); }
					else if (n > 20) { clearInterval(iv); tryOpen(); }
				}).catch(() => { if (n > 20) { clearInterval(iv); tryOpen(); } });
			}, 1500);
		};

// ═══════════════════════════════════════════════════════════════
// src/12-meta-reporting.js
// ═══════════════════════════════════════════════════════════════
		// ══════════ dsh-web 多人元数据：创建人/发送人/排序（S3+）══════════
	// dsh-web 为全平台共享单实例：session 与消息本身无平台用户身份。
	// 这里在浏览器侧（cookie 身份）记录归属并渲染：
	//   · 会话创建人 → 侧栏任务行 chip（startSession patch 上报）
	//   · 消息发送人 → 对话气泡上方署名（fetch 拦截 session.prompt 上报 rpcId+文本前缀，
	//     气泡 DOM 无 message id 可寻址 → 按规整文本前缀对齐）
	//   · 项目会话排序 → time（时间倒序，默认）/ creator（按创建人）/ manual（官方拖拽）
	//     排序开关注入官方项目行更多菜单（DOM 增强）；重排走官方 insertSessionBefore API。

	// 头像配色：与 madazi-web avatarBg 同 hash 算法（跨端同用户同色）
	const _avatarColors = ["#5e6ad2", "#8B5CF6", "#EC4899", "#10B981", "var(--dsw-alias-state-warning-primary,#FF9F0A)", "var(--dsw-alias-state-error-primary,#FF453A)", "#06B6D4"];
	const avatarBg = (name) => {
		const s = String(name || "?");
		let hash = 0;
		for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
		return _avatarColors[Math.abs(hash) % _avatarColors.length];
	};
	// 文本前缀规整（上报与气泡对齐共用同一函数：空白折叠 + 截断 40 字）
	const _normPrefix = (text) => String(text || "").replace(/\s+/g, " ").trim().slice(0, 40);
	const _pidOfPath = (p) => {
		const m = String(p || "").match(/\/generated\/([0-9a-fA-F-]{36})\/?$/);
		return m ? m[1] : null;
	};

	// 项目会话元数据缓存（60s TTL；上报/排序变更后失效）
	const _metaCache = new Map();
	const getSessionMeta = (pid, force) => {
		if (!pid) return Promise.resolve({});
		const c = _metaCache.get(pid);
		if (!force && c && !c.inflight && Date.now() - c.at < 60000) return Promise.resolve(c.data || {});
		if (c && c.inflight) return c.inflight;
		const p = madaziFetch("/dsh/session-meta/" + pid).then((d) => {
			const data = d && !d.error ? d : {};
			_metaCache.set(pid, { at: Date.now(), data, inflight: null });
			return data;
		}).catch(() => {
			_metaCache.set(pid, { at: Date.now(), data: {}, inflight: null });
			return {};
		});
		_metaCache.set(pid, { at: c ? c.at : 0, data: c ? c.data : {}, inflight: p });
		return p;
	};
	const invalidateMeta = (pid) => { if (pid) _metaCache.delete(pid); };

	// sessionId → projectId（workspaces 快照反查；快照未 ready 时返回 null）
	const _pidOfSession = (ctx, sessionId) => {
		try {
			const snap = ctx.workspaces && ctx.workspaces.list && ctx.workspaces.list.getSnapshot();
			const items = (snap && snap.items) || [];
			for (const w of items) {
				if (w && w.sessionIds && w.sessionIds.indexOf(sessionId) !== -1) return _pidOfPath(w.path);
			}
		} catch (e) { /* ignore */ }
		return null;
	};

	// 当前会话所属项目（气泡发送人查询用）
	const _currentProjectId = (ctx) => {
		try {
			const cur = ctx.sessions && ctx.sessions.list && ctx.sessions.list.getSnapshot().current;
			return cur ? _pidOfSession(ctx, cur) : null;
		} catch (e) { return null; }
	};

	// ── 消息发送人上报：拦截 window.fetch 的 session.prompt（rpcId 在请求 envelope 里）
		const startSenderReporting = (ctx) => {
			if (window.__madaziFetchHooked) return;
			window.__madaziFetchHooked = true;
			const pending = window.__madaziPendingSender = window.__madaziPendingSender || new Map();
			let meCache = null, meAt = 0;
			const getMe = async () => {
				if (meCache && Date.now() - meAt < 60000) return meCache;
				const d = await madaziFetch("/auth/me");
				const u = d && !d.error ? (d.user || d) : null;
				if (u && (u.id || u.username)) { meCache = u; meAt = Date.now(); }
				return u;
			};
			const origFetch = window.fetch.bind(window);
			window.fetch = (input, init) => {
				try {
					const url = typeof input === "string" ? input : (input && input.url) || "";
					// ★ 2026-09-04 适配 0.1.2：RPC 由点号改斜杠（/api/session/prompt）；两形态都匹配
					if (/session[./]prompt/.test(url) && init && init.body) {
						const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
						// ★ 0.1.2 信封：payload.args.request 内嵌 sessionId/content（探针实测）；老版本平铺 payload.*
						const reqArgs = (body && body.payload && body.payload.args && body.payload.args.request) || {};
						const sid = reqArgs.sessionId || (body && body.payload && body.payload.sessionId) || "";
						// ★ 2026-09-04 后台会话循环触发：该会话发起消息 → 让浏览器泵为其起独立长轮询
						//   （后台会话浏览器操作各自独立 tab 执行，不依赖切到前台）
						// ★ 发起者定向已权威化：不再在此上报发起者——网关（madazi-server）拦截
						//   session/prompt 按 cookie 身份识别发起者并推送 host（本拦截会被
						//   0.1.2 模块级 fetch 绕过，本就不可靠）。
						try { const reg = window.__madaziRegisterBrowserPrompt; if (typeof reg === "function" && sid) reg(sid); } catch (e) { /* ignore */ }
						if (body && body.rpcId && sid) {
							const text = (reqArgs.content || []).filter((p) => p && p.type === "text").map((p) => p.text).join(" ");
							const prefix = _normPrefix(text);
							getMe().then((u) => {
								if (!u) return;
								pending.set(sid + "\n" + prefix, { id: u.id, username: u.username || u.id });
								const report = (pid) => {
									if (!pid) return;
									madaziFetch("/dsh/message-sender", {
										method: "POST",
										body: JSON.stringify({ rpcId: body.rpcId, sessionId: sid, projectId: pid, textPrefix: prefix })
									}).then(() => {
										invalidateMeta(pid);
										try { window.__madaziRescan && window.__madaziRescan(); } catch (e) { /* ignore */ }
									}).catch(() => {});
								};
								let pid = _pidOfSession(ctx, sid);
								if (pid) report(pid);
								else {
									let tries = 0;
									const iv = setInterval(() => {
										tries++;
										pid = _pidOfSession(ctx, sid);
										if (pid) { clearInterval(iv); report(pid); }
										else if (tries >= 8) clearInterval(iv);
									}, 1500);
								}
							}).catch(() => {});
						}
					}
				} catch (e) { /* 拦截失败不影响原请求 */ }
				return origFetch(input, init);
			};
		};

	// ── 会话创建人上报：patch startSession，current 切到新会话后上报
	const startOwnerReporting = (ctx) => {
		const wsSvc = ctx.workspaces;
		if (!wsSvc || typeof wsSvc.startSession !== "function" || wsSvc.__madaziStartHooked) return;
		const orig = wsSvc.startSession.bind(wsSvc);
		wsSvc.startSession = function (wid) {
			const r = orig(wid);
			try { _reportNewOwner(ctx); } catch (e) { /* ignore */ }
			return r;
		};
		try { wsSvc.__madaziStartHooked = true; } catch (e) { /* frozen 原型场景已遮蔽 */ }
	};
	const _reportNewOwner = (ctx) => {
		let tries = 0;
		const t = setInterval(() => {
			tries++;
			if (tries > 20) { clearInterval(t); return; }
			try {
				const cur = ctx.sessions && ctx.sessions.list && ctx.sessions.list.getSnapshot().current;
				if (!cur) return;
				const pid = _pidOfSession(ctx, cur);
				if (!pid) return;
				clearInterval(t);
				madaziFetch("/dsh/session-owner", {
					method: "POST",
					body: JSON.stringify({ sessionId: cur, projectId: pid })
				}).then(() => {
					invalidateMeta(pid);
					try { window.__madaziRescan && window.__madaziRescan(); } catch (e) { /* ignore */ }
				}).catch(() => {});
			} catch (e) { clearInterval(t); }
		}, 500);
	};

// ═══════════════════════════════════════════════════════════════
// src/13-ordering.js
// ═══════════════════════════════════════════════════════════════
	// ── 会话排序引擎（显示层 CSS order 方案）
	//   背景：官方 orderBy（localStorage dsh.workspace.view.v5，默认 updated）下，
	//   侧栏显示序 = 客户端本地 account order（recency 派生），manual 模式同样本地 stored 优先
	//   —— insertSessionBefore 的服务端 sessionIds 重排在其他端不生效（reconcile 保留 stored）。
	//   故采用纯显示层：groupSection 转 flex 列 + 行 style.order，每端独立从同步数据
	//   （sessions 快照 updatedAt + 服务端 owners 元数据）计算同一目标序，零 RPC、零冲突。
	//   mode: time=updatedAt 倒序（默认）/ creator=创建人分组 / 其他=不动（官方原生序）。
	// 会话行标题提取：官方行 = [slot][title span][time span][actions]，整行 textContent
	// 会混入时间（「xxx 2小时」）导致 byId.title 匹配失败 → 只取 class 含 "title" 的 span。
	const _rowTitle = (row) => {
		for (const el of row.children) {
			if (el.tagName === "SPAN" && (el.className || "").toString().indexOf("title") !== -1) return (el.textContent || "").trim().slice(0, 64);
		}
		return (row.textContent || "").trim().slice(0, 64);
	};
	const startSessionOrdering = (ctx) => {
		if (window.__madaziOrderingStarted) return;
		window.__madaziOrderingStarted = true;
		let timer = null;
		const compute = (ids, mode, byId, owners) => {
			const arr = ids.slice();
			if (mode === "creator") {
				arr.sort((a, b) => {
					const oa = (owners[a] && owners[a].username) || "\uffff";
					const ob = (owners[b] && owners[b].username) || "\uffff";
					if (oa !== ob) return oa < ob ? -1 : 1;
					return ((byId[b] && byId[b].updatedAt) || 0) - ((byId[a] && byId[a].updatedAt) || 0);
				});
			} else {
				arr.sort((a, b) => ((byId[b] && byId[b].updatedAt) || 0) - ((byId[a] && byId[a].updatedAt) || 0));
			}
			return arr;
		};
		const applyOnce = async () => {
			const snap = ctx.sessions && ctx.sessions.list && ctx.sessions.list.getSnapshot();
			const byId = (snap && snap.byId) || {};
			// 每个项目一个 groupSection：首行=项目分组行（startRowMeta 注入 madaziProjectId）
			const sections = document.querySelectorAll('[role="treeitem"][aria-expanded]');
			for (const projRow of sections) {
				const pid = projRow.dataset && projRow.dataset.madaziProjectId;
				const section = projRow.closest('[class*="groupSection"]') || projRow.parentElement;
				if (!pid || !section) continue;
				// 本 section 的会话行：项目行之后的兄弟 treeitem（无 aria-expanded）
				const sessionRows = [];
				for (let el = projRow.nextElementSibling; el; el = el.nextElementSibling) {
					if (el.getAttribute && el.getAttribute("role") === "treeitem") {
						if (el.getAttribute("aria-expanded") !== null) break; // 下一个项目分组行
						sessionRows.push(el);
					}
				}
				const meta = await getSessionMeta(pid);
			const mode = meta && meta.sort;
			if (!mode || mode === "manual" || !sessionRows.length) {
				// 原生序：清掉历史 order 与 flex 布局，还原官方渲染
				for (const r of sessionRows) { if (r.style.order) r.style.order = ""; }
				section.classList.remove("madazi-sort-flex");
				continue;
			}
			// 行 → sessionId（chip 扫描写过的 dataset 优先；否则按 title 唯一匹配）
			const rowSid = new Map();
			for (const r of sessionRows) {
				let sid = r.dataset.madaziSid || null;
				if (!sid) {
					const title = _rowTitle(r);
					// ★ 行标题渲染用 byId[id].displayTitle（tree.ts sessionTitle），原始 title 可能不同
					const matches = title ? Object.keys(byId).filter((id) => byId[id] && !byId[id].blank && (byId[id].displayTitle === title || byId[id].title === title)) : [];
					if (matches.length === 1) sid = matches[0];
				}
				if (sid) rowSid.set(r, sid);
			}
				if (!rowSid.size) continue;
				const target = compute(Array.from(rowSid.values()), mode, byId, meta.owners || {});
				const rank = new Map(target.map((id, i) => [id, i]));
				// 未匹配行保持相对序排最前（order 默认 0），已匹配行按 rank+1
				for (const r of sessionRows) {
					const sid = rowSid.get(r);
					r.style.order = sid ? String((rank.get(sid) ?? 0) + 1) : "0";
				}
				// 溢出按钮（收起时「展开更多」）固定排最后
				for (const btn of section.querySelectorAll('[class*="sessionOverflowButton"]')) btn.style.order = "9999";
				section.classList.add("madazi-sort-flex");
			}
		};
		window.__madaziApplyOrder = () => {
			clearTimeout(timer);
			timer = setTimeout(() => applyOnce().catch(() => {}), 250);
		};
		try { ctx.workspaces && ctx.workspaces.list && ctx.workspaces.list.subscribe(() => window.__madaziApplyOrder()); } catch (e) { /* ignore */ }
		try { ctx.sessions && ctx.sessions.list && ctx.sessions.list.subscribe(() => window.__madaziApplyOrder()); } catch (e) { /* ignore */ }
		// 行重建（React 重渲染）后重新贴 order
		const mo = new MutationObserver(() => window.__madaziApplyOrder());
		mo.observe(document.body, { childList: true, subtree: true });
		window.__madaziApplyOrder();
	};

	// ── 排序开关注入官方项目行更多菜单（DOM 增强，复用官方菜单项样式）
	//   菜单归属识别：官方 Menu portal fixed 定位 ≈ 分组行 rect（bottom+4/left），行上有
	//   startRowMeta 注入的 dataset.madaziProjectId。
	const startSortMenuInject = () => {
		const MO = window.MutationObserver;
		if (!MO) return;
		// ★ 常驻 PublishHost（独立 React root）：侧栏官方菜单「发布为模板」的弹窗宿主。
		//   ProjectsEntry 只在「添加项目」弹窗打开时挂载，此前事件无监听者（点击无反应根因）。
		//   login 插件同模式（require("react-dom/client") 在壳 seed 表）；失败静默降级不影响主应用。
		if (!window.__madaziPubHost) {
			try {
				if (reactDomClient && typeof reactDomClient.createRoot === "function" && typeof document !== "undefined") {
					const host = document.createElement("div");
					host.id = "madazi-publish-host";
					document.body.appendChild(host);
					reactDomClient.createRoot(host).render(h(PublishHost));
					window.__madaziPubHost = "ok";
				} else {
					window.__madaziPubHost = "no-react-dom";
				}
			} catch (e) {
				window.__madaziPubHost = "err:" + String((e && e.message) || e);
			}
		}
		const MODES = [
			{ id: "time", label: "按时间倒序" },
			{ id: "creator", label: "按创建人排序" }
		];
		const findMenuProject = (menu) => {
			try {
				const mr = menu.getBoundingClientRect();
				const rows = document.querySelectorAll('[role="treeitem"][aria-expanded]');
				for (const row of rows) {
					const r = row.getBoundingClientRect();
					if (Math.abs(r.bottom + 4 - mr.top) < 8 && Math.abs(r.left - mr.left) < 8) {
						return (row.dataset && row.dataset.madaziProjectId) || null;
					}
				}
			} catch (e) { /* ignore */ }
			return null;
		};
		const buildItems = async (menu, pid) => {
			const viewport = menu.querySelector('[role="presentation"]') || menu;
			const refItem = menu.querySelector('[role="menuitem"]');
			if (!refItem) return;
			const meta = await getSessionMeta(pid, true);
			const current = (meta && meta.sort) || "time";
			// 分隔线
			const sep = document.createElement("div");
			sep.setAttribute("role", "separator");
			sep.style.cssText = "height:1px;margin:4px 8px;background:var(--dsw-alias-border-l2,var(--dsw-alias-border-l1))";
			viewport.appendChild(sep);
			for (const m of MODES) {
				const btn = document.createElement("button");
				btn.type = "button";
				btn.setAttribute("role", "menuitem");
				btn.className = refItem.className;
				btn.style.cssText = "width:100%";
				btn.textContent = (current === m.id ? "✓ " : "") + m.label;
				btn.addEventListener("click", (e) => {
					e.stopPropagation();
					madaziFetch("/dsh/session-sort/" + pid, { method: "PUT", body: JSON.stringify({ mode: m.id }) }).then(() => {
						invalidateMeta(pid);
						try { window.__madaziApplyOrder && window.__madaziApplyOrder(); } catch (err) { /* ignore */ }
					}).catch(() => {});
					// 触发官方 outside-pointerdown 关闭菜单
					try { document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); } catch (err) { /* ignore */ }
				});
				viewport.appendChild(btn);
			}
		};
		// ★「发布为模板」入口：点击捕获注入（不依赖几何匹配——Radix portal 菜单定位
		//   与行 rect 对不上时 MO+findMenuProject 会漏；改为点 ⋯ 时直接从行上取 pid）
		const publishInject = (menu, pid) => {
			const viewport = menu.querySelector('[role="presentation"]') || menu;
			const refItem = menu.querySelector('[role="menuitem"]');
			if (!refItem || viewport.querySelector(".madazi-menu-publish")) return;
			const sep = document.createElement("div");
			sep.setAttribute("role", "separator");
			sep.style.cssText = "height:1px;margin:4px 8px;background:var(--dsw-alias-border-l2,var(--dsw-alias-border-l1))";
			const btn = document.createElement("button");
			btn.type = "button";
			btn.setAttribute("role", "menuitem");
			btn.className = refItem.className;
			btn.classList.add("madazi-menu-publish");
			btn.style.cssText = "width:100%";
			btn.textContent = "发布为模板";
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				// 项目对象：拉平台列表按 id 匹配（失败也开向导，仅缺显示名）
				madaziFetch("/projects").then((list) => {
					const p = (Array.isArray(list) ? list : []).find((x) => x && x.id === pid);
					window.dispatchEvent(new CustomEvent("madazi-publish-template", { detail: { id: pid, name: p ? (p.name || "") : "" } }));
				}).catch(() => {
					window.dispatchEvent(new CustomEvent("madazi-publish-template", { detail: { id: pid, name: "" } }));
				});
				// 触发官方 outside-pointerdown 关闭菜单
				try { document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); } catch (err) { /* ignore */ }
			});
			viewport.appendChild(sep);
			viewport.appendChild(btn);
			console.log("[madazi] publish menu item injected, pid:", pid);
		};
		const tryPublishInject = (pid, attempt) => {
			if (attempt > 8) return;
			// 最新出现的菜单 = 刚打开的这个（Radix 关闭后卸载，无残留）。
			// ★ 不按 data-madazi-publish 标记过滤：路径 2 会先标记再注入，若过滤会自锁
			//   （标记过的菜单被排除 → 重试 8 次放弃 → 永远注入不进去）。
			//   去重由 publishInject 内部 .madazi-menu-publish 检查负责。
			const menus = Array.from(document.querySelectorAll('div[role="menu"]'));
			const menu = menus.length ? menus[menus.length - 1] : null;
			if (!menu || !menu.querySelector('[role="menuitem"]')) { setTimeout(() => tryPublishInject(pid, attempt + 1), 150); return; }
			publishInject(menu, pid);
		};
		// ★ 项目名提取：分组行第 3 子元素内的 span（与 startRowMeta 同源结构：
		//   [chevron][folder svg][标题容器>span]），aria-label 兜底（可能只是「操作」无项目名）
		const rowProjectName = (row) => {
			if (!row) return null;
			const pt = row.children && row.children[2];
			const titleEl = pt && pt.querySelector ? pt.querySelector("span") : null;
			const n = (titleEl ? titleEl.textContent : (pt ? pt.textContent : "")).trim();
			if (n) return n;
			return null;
		};
		const labelProjectName = (btn) => {
			const label = btn.getAttribute("aria-label") || "";
			return (label.match(/[“"'']([^”"'']+)["'']/) || [])[1] || null;
		};
		// 几何兜底：⋯ 按钮可能不在 treeitem DOM 内（兄弟容器渲染）——按钮中心点落在哪个分组行
		const geomRow = (btn) => {
			try {
				const br = btn.getBoundingClientRect();
				const cy = br.top + br.height / 2;
				for (const r of document.querySelectorAll('[role="treeitem"][aria-expanded]')) {
					const rr = r.getBoundingClientRect();
					if (rr.height > 0 && cy >= rr.top && cy <= rr.bottom && br.left >= rr.left - 4 && br.left <= rr.right + 4) return r;
				}
			} catch (e) { /* ignore */ }
			return null;
		};
		// 按项目名解析 pid 后注入（列表按名匹配；file 子目录名匹配不到自然过滤）
		const tryPublishInjectByName = (name) => {
			if (!name) return;
			madaziFetch("/projects").then((list) => {
				const p = (Array.isArray(list) ? list : []).find((x) => x && x.name === name);
				if (p) { console.log("[madazi] publish inject by name:", name); tryPublishInject(p.id, 0); }
			}).catch(() => {});
		};
		window.__madaziPubMenu = "v4";
		// 路径 1（点击捕获）：点分组行 icon 按钮 → 记录项目名 → 菜单弹出后注入
		document.body.addEventListener("click", (e) => {
			const btn = e.target && e.target.closest ? e.target.closest("button") : null;
			if (!btn || (btn.textContent || "").trim().length > 4) return; // 只认 icon 按钮（⋯/空文本）
			const row = (btn.closest ? btn.closest('[role="treeitem"][aria-expanded]') : null) || geomRow(btn);
			if (!row) return;
			const name = rowProjectName(row) || labelProjectName(btn);
			if (!name) return;
			window.__madaziLastProjName = name;
			if (row.dataset && row.dataset.madaziProjectId) {
				setTimeout(() => tryPublishInject(row.dataset.madaziProjectId, 0), 120);
			} else {
				setTimeout(() => tryPublishInjectByName(name), 120);
			}
		}, true);
		const mo = new MO(() => {
			for (const menu of document.querySelectorAll('div[role="menu"]')) {
				const items = menu.querySelectorAll('[role="menuitem"]');
				if (!items.length) continue;
				const texts = Array.from(items).map((b) => (b.textContent || "").trim());
				// 路径 2（菜单内容特征）：项目行菜单必含「删除项目」（locale 覆盖后；
				//   合并前的短窗口内仍是「删除工作区」，一并识别）→ 注入「发布为模板」
				if (!menu.dataset.madaziPublish) {
					const isProjectMenu = texts.some((s) => s.indexOf("删除项目") !== -1 || s.indexOf("删除工作区") !== -1 || s.indexOf("Delete project") !== -1 || s.indexOf("Delete workspace") !== -1);
					if (isProjectMenu) {
						menu.dataset.madaziPublish = "1"; // 仅防 MO 自身重入；注入去重靠 publishInject 内部检查
						// pid 解析优先级：菜单几何匹配行 → 点击时记录的项目名；拿到 pid 直接注入
						const pid2 = findMenuProject(menu);
						if (pid2) publishInject(menu, pid2);
						else if (window.__madaziLastProjName) tryPublishInjectByName(window.__madaziLastProjName);
					}
				}
				// 排序开关注入（原有逻辑）
				if (menu.dataset.madaziSort === "done") continue;
				const isProjectMenu2 = texts.some((s) => s.indexOf("删除项目") !== -1 || s.indexOf("Delete project") !== -1);
				if (!isProjectMenu2) continue;
				menu.dataset.madaziSort = "done";
				const pid = findMenuProject(menu);
				if (pid) buildItems(menu, pid);
			}
		});
		mo.observe(document.body, { childList: true, subtree: true });
	};

	// ── 侧栏任务行创建人 chip（DOM 注入；title 唯一匹配 session）
	const startSessionOwnerChips = (ctx) => {
		const scan = async () => {
			const rows = document.querySelectorAll('[role="treeitem"]');
			for (const row of rows) {
				if (row.getAttribute("aria-expanded") !== null) continue; // 分组行
				if (row.dataset.madaziOwnerChip) continue;
				const snap = ctx.sessions && ctx.sessions.list && ctx.sessions.list.getSnapshot();
				const byId = (snap && snap.byId) || {};
				const title = _rowTitle(row);
				if (!title) continue;
				const matches = Object.keys(byId).filter((id) => byId[id] && !byId[id].blank && (byId[id].displayTitle === title || byId[id].title === title));
				if (matches.length !== 1) continue; // 重名/blank 不注（重命名后行重建会重扫）
				const sid = matches[0];
				// 所属项目：workspaces 快照反查（★ 不能靠向前找兄弟 treeitem——官方每个
				// treeitem 行独立包在 SPAN 容器，行间非兄弟，madaziProjectId 拿不到）
				const pid = _pidOfSession(ctx, sid);
				if (!pid) continue;
				const meta = await getSessionMeta(pid);
				const owner = meta && meta.owners && meta.owners[sid];
				if (!owner) continue; // 上报完成前 owner 未知：不标记，meta 失效后重扫补
				row.dataset.madaziOwnerChip = "1";
				// title 元素：行内文本等于 session 显示标题的 span（displayTitle，非原始 title）
				let titleEl = null;
				for (const el of row.children) {
					if (el.tagName === "SPAN" && (el.textContent || "").trim() === byId[sid].displayTitle) { titleEl = el; break; }
				}
				const chip = document.createElement("span");
				chip.className = "madazi-row-owner";
				chip.title = "创建人 " + owner.username;
				const av = document.createElement("i");
				av.style.background = avatarBg(owner.username);
				av.textContent = (owner.username[0] || "?").toUpperCase();
				const nm = document.createElement("b");
				nm.textContent = owner.username;
				chip.appendChild(av);
				chip.appendChild(nm);
				if (titleEl && titleEl.nextSibling) row.insertBefore(chip, titleEl.nextSibling);
				else row.appendChild(chip);
			}
		};
		const mo = new MutationObserver(() => { scan().catch(() => {}); });
		mo.observe(document.body, { childList: true, subtree: true });
		// 上报完成回调（meta 失效后重扫补 chip）：多个扫描器共享同一全局入口
		window.__madaziRescans = window.__madaziRescans || [];
		window.__madaziRescans.push(() => scan().catch(() => {}));
		window.__madaziRescan = window.__madaziRescan || (() => {
			for (const fn of window.__madaziRescans) { try { fn(); } catch (e) { /* ignore */ } }
		});
		scan().catch(() => {});
	};

	// ── 对话气泡发送人（DOM 注入：user 气泡行前插署名；文本前缀对齐 sender）
	// ★ 2026-09-04 适配 0.1.2 DOM：user 气泡外层 textContent 含时间戳（「启动项目8月31日 16:25」），
	//   与上报存的纯正文前缀不一致 → 匹配永远失败（dsh_message_senders 0 行根因）。
	//   正文稳定锚点 = user 气泡内 [class*="bubble"] 元素（0.1.2: Sixlwa_bubble）。
	//   回退：过滤日期时间戳（如「8月31日 16:25」「2026-09-04 12:00」）后的 textContent。
	const _senderPrefixOf = (row) => {
		try {
			const b = row.querySelector('[class*="bubble"]');
			if (b && (b.textContent || "").trim()) return _normPrefix(b.textContent);
		} catch (e) { /* ignore */ }
		return _normPrefix(String(row.textContent || "").replace(/\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}\s*\d{1,2}:\d{2}/g, ""));
	};
	const startBubbleSenders = (ctx) => {
		// ★ 2026-09-04 发完即显修复：服务端网关记录（server 直接入库）不走前端 madaziFetch，
		//   不触发 invalidateMeta → scan 读的 session-meta 是旧 60s 缓存，新消息署名缺失要等过期。
		//   这里对「当前项目有未署名 user 气泡」做限流 force 重取（3s 节流），再重扫补插。
		let _lastForceAt = 0;
		const scan = async (opts) => {
			const rows = document.querySelectorAll('[data-chat-flow-kind="user"]');
			if (!rows.length) return;
			const snap = ctx.sessions && ctx.sessions.list && ctx.sessions.list.getSnapshot();
			const sid = snap && snap.current;
			if (!sid) return;
			const pid = _currentProjectId(ctx);
			const pending = window.__madaziPendingSender || new Map();
			let meta = null;
			let missing = false;
			for (const row of rows) {
				const prev = row.previousElementSibling;
				if (prev && prev.classList && prev.classList.contains("madazi-sender")) continue; // 已注入
				const prefix = _senderPrefixOf(row);
				if (!prefix) continue;
				let sender = pending.get(sid + "\n" + prefix);
				if (!sender) {
					if (!meta && pid) meta = await getSessionMeta(pid);
					if (meta && meta.byPrefix) sender = meta.byPrefix[sid + "\n" + prefix];
				}
				if (!sender) { missing = true; continue; } // 有未署名的新气泡 → 触发 force
				const el = document.createElement("div");
				el.className = "madazi-sender";
				const av = document.createElement("i");
				av.style.background = avatarBg(sender.username);
				av.textContent = (sender.username[0] || "?").toUpperCase();
				const nm = document.createElement("span");
				nm.textContent = sender.username;
				el.appendChild(av);
				el.appendChild(nm);
				row.parentNode && row.parentNode.insertBefore(el, row);
			}
			// 限流 force：当前项目 + 有未署名气泡 + 3s 节流内未 force 过 → 拉新 meta 后重扫补插
			if (missing && pid && !(opts && opts.forceDone) && Date.now() - _lastForceAt > 3000) {
				_lastForceAt = Date.now();
				try {
					await getSessionMeta(pid, true); // force 写回 _metaCache
					await scan({ forceDone: true }); // 用新缓存重扫，补插署名
				} catch (e) { /* 重取失败等下次 mutation */ }
			}
		};
		const mo = new MutationObserver(() => { scan().catch(() => {}); });
		mo.observe(document.body, { childList: true, subtree: true });
		window.__madaziRescans = window.__madaziRescans || [];
		window.__madaziRescans.push(() => scan().catch(() => {}));
		window.__madaziRescan = window.__madaziRescan || (() => {
			for (const fn of window.__madaziRescans) { try { fn(); } catch (e) { /* ignore */ } }
		});
		scan().catch(() => {});
	};

// ═══════════════════════════════════════════════════════════════
// src/14-workspace-title.js
// ═══════════════════════════════════════════════════════════════
	/**
	 * ★ 工作区标题守护：平台项目工作区有多条创建路径——
	 *   ① openProjectWorkspace（已即时 rename）②「添加工作区」目录流 onPicked
	 *   （官方 owner 调 createWorkspace({path})，无 title 入参）③ git 导入/zip 上传表单。
	 * 官方 create 默认 title = path basename = 项目 uuid。这里订阅 workspaces 快照，
	 * 发现 uuid 形标题的平台目录工作区即查项目名（listProjects RPC，30s TTL 缓存）并 rename，
	 * 覆盖全部创建路径且即时生效；用户手动改名（非 uuid 标题）永不覆盖。
	 */
	const startWorkspaceTitleWatch = (ctx) => {
		const svc = ctx.workspaces;
		if (!svc || !svc.list || typeof svc.list.subscribe !== "function" || typeof svc.rename !== "function") return;
		// ★ 平台项目工作区判定：path 形如 <部署根>/generated/<uuid>（k8s=/app/generated/<uuid>，
		//   单机版=注入 PROJECTS_ROOT/<uuid>）→ 按路径模式匹配，部署无关（与 wb-src 同款正则）。
		const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
		const pidOfPath = (p) => {
			const m = String(p || "").match(/[\\/]generated[\\/]([0-9a-fA-F-]{36})/);
			return m ? m[1] : null;
		};
		let nameById = null;
		let namesAt = 0;
		let inflight = null;
		// 负缓存穿透标记：强刷后仍不存在的 pid（异常目录/无权限），60s 内不再为它强刷（防快照变化风暴）
		const missUntil = new Map();
		const fetchNames = async () => {
			const list = await madaziFetch("/projects");
			const m = new Map();
			for (const p of Array.isArray(list) ? list : []) m.set(p.id, p.name || p.title || p.id);
			return m;
		};
		const loadNames = (force) => {
			if (!force && nameById && Date.now() - namesAt < 30000) return Promise.resolve(nameById);
			if (!inflight) {
				inflight = fetchNames().then((m) => {
					nameById = m;
					namesAt = Date.now();
					return m;
				}).finally(() => { inflight = null; });
			}
			return inflight;
		};
		const check = async () => {
			try {
				const snap = svc.list.getSnapshot();
				const items = (snap && snap.items) || [];
				const need = items.filter((w) => w && pidOfPath(w.path) && UUID_RE.test(w.title || ""));
				if (!need.length) return;
				let names = await loadNames();
				// ★ 负缓存穿透：待命中的 pid 不在缓存（典型=30s TTL 内新建的项目，
				//   createWorkspace 触发本 check 时缓存还是旧列表）→ 强制绕过 TTL 重拉，
				//   否则侧栏分组停留 uuid 直到刷新页面（挂载 check 全新拉取才纠正）。
				const missing = need
					.map((w) => pidOfPath(w.path))
					.filter((pid) => pid && !names.has(pid) && (missUntil.get(pid) || 0) < Date.now());
				if (missing.length) {
					names = await loadNames(true).catch(() => names);
					for (const pid of missing) if (pid && !names.has(pid)) missUntil.set(pid, Date.now() + 60000);
				}
				for (const w of need) {
					const pid = pidOfPath(w.path);
					const name = pid ? names.get(pid) : null;
					if (name && name !== w.title) {
						try {
							console.warn("[madazi-title] renaming", w.workspaceId, "->", name, "(was:", w.title, ")");
							await svc.rename(w.workspaceId, name);
						} catch (e) { console.warn("[madazi-title] rename failed:", w.workspaceId, String((e && e.message) || e)); }
					}
				}
			} catch { /* 快照/网络异常：下次快照变更再试 */ }
		};
		svc.list.subscribe(() => { check(); });
		check(); // 挂载即校准（覆盖插件加载前已存在的 uuid 工作区）
		// ★ 暴露强制校准入口：创建项目路径在 workspace 落地后立即调用，
		//   消除「创建瞬间/短时侧栏按 uuid 显示」的窗口（不等 subscribe 下一轮）
		window.__madaziTitleFix = check;
		return { check };
	};

	/**
	 * ★ 孤儿会话清扫：workspace 已被删除但其会话残留「未分组」（归档级联补齐前的存量）。
	 * 判定：session.cwd 在 /app/generated/<pid> 下 + 无任何 workspace 匹配该 path + 平台侧项目已归档/删除
	 * （listProjects 只返回存活项目）。三者同时成立才 archiveSession，避免误伤「项目还在、workspace 未建」的会话。
	 */
	const sweepOrphanSessions = async () => {
		try {
			const ctx = _madaziCtx;
			const sessions = ctx && ctx.sessions;
			const wsSvc = ctx && ctx.workspaces;
			if (!sessions || !sessions.list || !wsSvc || typeof wsSvc.archiveSession !== "function") return;
			const snap = sessions.list.getSnapshot();
			const phase = snap && snap.phase;
			if (phase && phase !== "ready" && phase !== "empty-with-ready") return; // 列表未加载完，下轮再试
			const items = (wsSvc.list && wsSvc.list.getSnapshot().items) || [];
			const paths = new Set(items.map((w) => String(w.path || "").replace(/\/+$/, "")));
			const list = await madaziFetch("/projects");
			if (!Array.isArray(list)) return;
			const live = new Set(list.map((p) => String(p.id)));
			let swept = 0;
			for (const sid of (snap.ids || [])) {
				const s = snap.byId && snap.byId[sid];
				const cwd = s && typeof s.cwd === "string" ? s.cwd.replace(/\/+$/, "") : "";
				if (!cwd || cwd.indexOf("/generated/") === -1 || paths.has(cwd)) continue;
				const m = cwd.match(/generated\/([0-9a-fA-F-]{36})/);
				if (!m || live.has(m[1])) continue;
				await wsSvc.archiveSession(sid).catch(() => {});
				swept++;
			}
			if (swept) console.warn("[madazi] orphan sessions archived: " + swept);
		} catch (e) { /* ignore */ }
	};

// ═══════════════════════════════════════════════════════════════
// src/15-apply.js
// ═══════════════════════════════════════════════════════════════
	/**
	 * Client plugin body.
	 * @param ctx - client root context.
	 */
	async function apply(ctx) {
			window.__madaziApply = (window.__madaziApply || 0) + 1;
			// ★ 未登录不初始化 madazi 插件：登录页 overlay 阶段不发起 /api/ws/presence 等认证请求。
			//   登录成功走 SPA 恢复链（login 插件 conn.reconnect，不整页 reload）→ apply 不会重跑，
			//   注册 __madaziRetryInit 由 login 插件登录成功后调用（幂等：__madaziSvc 已挂载则跳过）。
			const _deferInit = () => { window.__madaziRetryInit = () => { if (!window.__madaziSvc) apply(ctx); }; };
			try {
				const _meResp = await fetch("/api/auth/me", { credentials: "include" });
				if (!_meResp.ok) { _deferInit(); console.log("[madazi] not logged in, defer plugin init until login"); return; }
			} catch { _deferInit(); return; }
			try {
				// Mount the Host Remote contribution so the madazi namespace service exists.
				// Capture the service directly (avoids the cordis "without inject" guard on
				// ctx.remote.madazi, since this plugin itself performs the $mount).
				await ctx.remote.$mount(TYPERT_REMOTE);
			const madaziSvc = ctx.remote.namespaces.get("madazi").service;
		window.__madaziSvc = madaziSvc;
		_madaziCtx = ctx;
		window.__madaziWs = ctx.workspaces; // S6-official：workspaces client service（非 hook），供 PreviewControl 快照
			// ★ /分享技能 斜杠源：对话里把项目私有技能发布到市场（三级体系人工确认链路）
			try { installShareSkillSlash(ctx); } catch (e) { console.warn("[madazi] /分享技能 安装失败:", e); }
			// ★ @ 跨项目文件引用（第二个 @ 源）：官方源只搜当前 cwd，本源补用户有权限的其他项目，
			//   按项目名分节；mention 绝对路径（agent read 可读）；目录可逐级 drill
			try { installCrossProjectRef(ctx); } catch (e) { console.warn("[madazi] 跨项目 @ 安装失败:", e); }
			// ★ 技能市场入口：/ 面板头部固定区（DOM 注入，零官方 patch）+ /技能市场 兜底源
			try { installMarketHeaderWatch(); installMarketSlash(ctx); } catch (e) { console.warn("[madazi] 技能市场入口安装失败:", e); }
			// ★ 工作区标题守护（uuid 标题 → 项目名，全路径覆盖）：见 startWorkspaceTitleWatch 注释
			try { startWorkspaceTitleWatch(ctx); } catch (e) { console.error("[madazi] title watch failed:", e); }
				// ★ 全量铺陈：登录后把平台全部项目注册为侧栏工作区（「项目列表」= 全部项目）。
				//   延迟等 workspaces 服务就绪；30s 兜底补 create 竞态落空者（幂等，重复执行无害）。
				//   ★ 90s 周期兜底：官方 onboarding/设置面板等 store 重载会短暂刷空侧栏，周期幂等回填
				try {
					if (window.__madaziAdoptAll) {
						setTimeout(() => window.__madaziAdoptAll(), 3000);
						setTimeout(() => window.__madaziAdoptAll(), 20000);
						setInterval(() => window.__madaziAdoptAll(), 90000);
					}
					// ★ 空态自愈 watch：官方 store reload 把 workspace 列表清空的瞬间立即回填
					try { window.__madaziWatchEmptiness && setTimeout(window.__madaziWatchEmptiness, 4000); } catch { /* ignore */ }
				} catch (e) { console.warn("[madazi] adopt-all trigger failed:", e); }
			// ★ 孤儿会话清扫（归档级联前的存量残留）：会话列表异步就绪，延时三轮兜底
			setTimeout(() => { sweepOrphanSessions(); }, 6000);
			setTimeout(() => { sweepOrphanSessions(); }, 20000);
			setTimeout(() => { sweepOrphanSessions(); }, 60000);
			// ★ 删除项目接管：官方侧栏「删除工作区」→ 平台「删除项目」。
			//   workspaces 为共享服务实例（reflect.provide 单例），实例属性遮蔽原型 delete
			//   即可拦截官方 WorkspaceBrowser 的 deleteWorkspace 调用（官方确认弹窗复用）。
			//   流程：workspaceId →RPC resolveWorkspace→ path(/app/generated/<pid>)
			//   → DELETE /api/projects/:id（cookie 认证；非 admin 后端 403，错误回显官方弹窗）
			//   → 成功后 postMessage 通知父页（madazi-web iframe 宿主）→ 再调官方 delete
			//   移除 dsh workspace 记录（侧栏行消失，官方弹窗等待列表更新后自动关闭）。
			//   非平台目录（path 不含 /generated/<uuid>）的 workspace 保持官方原行为。
			try {
				const wsSvc = ctx.workspaces;
				if (wsSvc && typeof wsSvc.delete === "function" && !wsSvc.__madaziDeleteHooked) {
					const origDelete = wsSvc.delete.bind(wsSvc);
					const madaziDelete = async (workspaceId) => {
					let projectId = null;
					let wsPath = null;
					// ★ 先从客户端 list 快照直查 path（不走 RPC；RPC resolveWorkspace 仅作 fallback）
					try {
						const _snap = wsSvc.list && wsSvc.list.getSnapshot ? wsSvc.list.getSnapshot() : null;
						const _items = _snap && Array.isArray(_snap.items) ? _snap.items : [];
						// ★ 客户端 workspaces 服务无 get()（只有 list/create/rename/delete…）：
						//   path 真相在 list 快照 items[].path（workspaceId 匹配）
						const ws = _items.find((it) => it && it.workspaceId === workspaceId) || null;
						if (ws && ws.path) {
							wsPath = String(ws.path).replace(/\/+$/, "");
							const m = ws.path.match(/generated\/([0-9a-fA-F-]{36})\/?$/);
							if (m) projectId = m[1];
						}
					} catch { /* ignore */ }
					// ★ fallback：RPC resolveWorkspace（node 半查 workspace path）
					if (!projectId) {
						try {
							if (window.__madaziSvc && window.__madaziSvc.resolveWorkspace) {
								const r = await window.__madaziSvc.resolveWorkspace(workspaceId);
								const v = r && r.ok ? r.value : r;
								const p = (v && v.path) || "";
								const m = p.match(/generated\/([0-9a-fA-F-]{36})\/?$/);
								if (m) projectId = m[1];
							}
						} catch { /* resolve 失败：按普通 workspace 删 */ }
					}
						if (projectId) {
						const resp = await madaziFetch("/projects/" + projectId, { method: "DELETE" });
						if (resp && resp.error) {
							// 404 = 平台侧已删除（如上次 dsh workspace 移除失败的补偿重试），放行走官方 delete 清残留行
							if (resp.error !== "Not found") {
								throw new Error(typeof resp.error === "string" ? resp.error : "删除项目失败");
							}
						}
						// 通知父页（同域 iframe 宿主）：删除的是当前项目时由 madazi-web 跳回首页
						try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: "madazi:projectDeleted", projectId }, "*"); } catch { /* ignore */ }
					}
					// ★ 级联归档该 workspace 的全部会话（官方 delete 只移除 workspace 行，
					//   会话会掉进「未分组」残留）——用官方 workspaces.archiveSession（侧栏会话行同款）
					if (wsPath && typeof wsSvc.archiveSession === "function" && ctx.sessions && ctx.sessions.list) {
						try {
							const ssnap = ctx.sessions.list.getSnapshot();
							for (const sid of (ssnap.ids || [])) {
								const s = ssnap.byId && ssnap.byId[sid];
								const cwd = s && typeof s.cwd === "string" ? s.cwd.replace(/\/+$/, "") : "";
								if (cwd && cwd === wsPath) {
									await wsSvc.archiveSession(sid).catch(() => {});
								}
							}
						} catch { /* 级联失败不阻断归档 */ }
					}
						return origDelete(workspaceId);
					};
					try { wsSvc.delete = madaziDelete; }
					catch { Object.getPrototypeOf(wsSvc).delete = madaziDelete; }
					try { wsSvc.__madaziDeleteHooked = true; } catch { /* frozen 实例时原型已遮蔽 */ }
					window.__madaziDeleteHook = "ok";
				} else if (wsSvc && wsSvc.__madaziDeleteHooked) {
					window.__madaziDeleteHook = "already";
				}
			} catch (e) { window.__madaziDeleteHook = "err:" + String((e && e.message) || e); }
			// ★ 文案定制：官方「工作区」语义改「项目」（合并进官方 workspace 字典，i18n 正道，零 DOM hack）。
			//   本插件在 bundles 末位激活（官方 ui-workspace 已注册字典），直接改写其 zh/en 表。
			try {
				const zhOverride = {
					"section.workspaces": "项目列表",
					"delete.workspace": "归档项目",
				"delete.desc": "项目将归档：源码保留，预览/会话等运行时资源清理。归档后不再显示在项目列表中。",
				"delete.pending": "正在归档项目…",
					"workspace.add": "添加项目",
					"menu.addWorkspace": "添加项目…"
				};
				const enOverride = {
					"section.workspaces": "Projects",
					"delete.workspace": "Archive project",
				"delete.desc": "Project will be archived: source preserved, runtime resources cleaned. No longer shown in project list.",
				"delete.pending": "Archiving project…",
					"workspace.add": "Add project",
					"menu.addWorkspace": "Add project…"
				};
				const mergeWsLocale = (attempt) => {
					try {
						const table = ctx.locale && ctx.locale.dicts && ctx.locale.dicts.get("workspace");
						if (!table || !table.has("zh")) {
							if (attempt < 20) setTimeout(() => mergeWsLocale(attempt + 1), 500);
							return;
						}
						const zhDict = table.get("zh"); if (zhDict) Object.assign(zhDict, zhOverride);
						const enDict = table.get("en"); if (enDict) Object.assign(enDict, enOverride);
						window.__madaziWsLocale = "merged";
					} catch (e) { window.__madaziWsLocale = "err:" + String((e && e.message) || e); }
				};
				mergeWsLocale(0);
			} catch { /* ignore */ }
			// ★ 兜底：section label 若在字典合并前已渲染（locale 无重渲染），DOM 层直接改写
			try { _startSectionLabelPatch(); } catch { /* ignore */ }
			// S3 hero 行：sidebar 项目分组行下方注入创建人/成员/加号（DOM 增强，官方 bundle 零修改）
			try { startRowMeta(); } catch { /* ignore */ }
			// ★ 未分组会话过滤：无项目权限的会话不可见（不在任何 workspace 下的会话按 cwd 判归属）
			// ★ 2026-08-28 退役：v63/v64 遗留 DOM 补丁，与源码级 gate（ui-workspace membership.ts
			//   渲染源头裁剪 + server 数据层过滤）职责重叠，且 R2 用 title 精确匹配 byId 判定行归属，
			//   匹配失败即 fail-closed 隐藏——把成员项目的会话行也误隐藏（"有项目无会话"）。
			//   会话可见性现由 membership.ts projectGate 在渲染源头统一裁决，此处不再介入。
			// try { startUngroupedSessionFilter(ctx); } catch (e) { console.warn("[madazi] ungrouped session filter failed:", e); }
		try { _startGlobalOnlineWS(); } catch { /* ignore */ }
			// ★ 会话元数据：消息发送人上报（fetch 拦截）+ 会话创建人上报（startSession patch）
			try { startSenderReporting(ctx); } catch { /* ignore */ }
			try { startOwnerReporting(ctx); } catch { /* ignore */ }
			// ★ 排序引擎（CSS order 显示层）+ 项目菜单排序开关 + 任务行创建人 chip + 气泡发送人署名
			try { startSessionOrdering(ctx); } catch (e) { console.error("[madazi] session ordering failed:", e); }
			try { startSortMenuInject(); } catch (e) { console.error("[madazi] sort menu inject failed:", e); }
			// 会话行创建人 chip（DOM 注入）已按用户要求撤除（2026-08-28）
			// try { startSessionOwnerChips(ctx); } catch (e) { console.error("[madazi] owner chips failed:", e); }
			try { startBubbleSenders(ctx); } catch (e) { console.error("[madazi] bubble senders failed:", e); }
				window.__madaziMounted = "madazi:" + (madaziSvc ? "ok" : "missing");
				ctx.effect(() => ctx.locale.register(NS, { zh: {}, en: {} }), "madazi-hello: dicts");
				// Shared: adopt a platform project directory as a workspace and open a session.
				// B12 安全设计：API 不外泄用户无权访问的路径（source_path 由 server 按部署环境
				// 生成：k8s=容器内 /app/generated/<id>（web pod 与 server 共享 PVC）；单机版=
				// 注入的 PROJECTS_ROOT/<id>。优先采用 create/install 响应自带的 source_path
				// （真实可靠）；缺失时（list 打开的已存在项目）走 B12 专用 workspace-path 接口，
				// 由 server 按部署形态唯一推导，前端不再硬编码任何路径。
				const openProjectWorkspace = async (p) => {
					const wsPath = (p && p.source_path)
						? p.source_path
						: await window.__madaziResolveWorkspacePath(p && p.id);
					if (!wsPath) throw new Error("无法解析项目工作区路径（无权访问或网络异常）");
					const ws = await ctx.workspaces.create({ path: wsPath });
				// ★ create 返回 RemoteResult{ ok, value:{workspace:{...}} }（WorkspaceView 在 value.workspace
				//   内层），不能直取 ws.workspaceId/ws.id（永远 undefined → rename 从未执行 → 侧栏 uuid 残留）。
				//   统一解包口径：value.workspace.workspaceId 优先，兼容旧版直接返回 view 的结构。
				const _wsView = (ws && ws.ok && ws.value && ws.value.workspace) ? ws.value.workspace : (ws || null);
				const id = _wsView && (_wsView.workspaceId || _wsView.id);
				if (!id) return;
				// S2-3: create 无 title 入参、ws.setTitle 也不存在——用 ctx.workspaces.rename 立即设项目名。
				// 不改则 workspace title = basename = uuid，侧栏与新建会话的工作区分组全显示 uuid。
				try { await ctx.workspaces.rename(id, p.name || p.title || p.id); } catch (e) { /* 重名冲突(workspace-name-conflict)非致命 */ }
				// ★ 创建+重命名后、startSession 前，强制侧栏渲染一次新 workspace 行
				//   cordis list store 在 create 后更新，但 startSession 紧接着切会话视图，
				//   React 批处理可能跳过侧栏的 workspace list 渲染。主动触发排序让 DOM 先更新。
				try { window.__madaziApplyOrder && window.__madaziApplyOrder(); } catch { /* ignore */ }
				await new Promise(r => setTimeout(r, 50));
				await ctx.workspaces.startSession(id);
				// ★ 建完/打开项目后刷新 membership 成员表（gate 放行新项目，侧栏即时出现新项目行；
				//   否则 gate 的 allowed 集合不含新 pid → 新 workspace 被门禁隐藏，只能整页刷新才看到。
				//   覆盖模板市场/git/zip/技能市场/快速创建等所有 create→open 路径）。
				try { if (window.__madaziMembershipRefresh) window.__madaziMembershipRefresh(); } catch { /* ignore */ }
			};
				// ★ 暴露统一「打开/创建项目工作区」入口：create → rename(项目名) → startSession 同步完成，
				//   各创建路径（模板快速创建 / git / zip / 市场装模板）统一走它即时命名，
				//   不再依赖 watch 兜底（官方 createWorkspace 无 title 入参，title=basename=uuid，
				//   异步 rename 有 uuid 显示窗口）
				window.__madaziOpenProject = openProjectWorkspace;
				// P1 dock 面板已撤除（S2-3：P3 sidebar 升级为主入口）
				// P2 header 任务徽标已撤除（S2-3：任务入口并入设置分节与工作区）
				// 项目入口：接管「添加工作区」目录流（priority -1 shadow 官方 browse 选择器）。
				// S2-3: 左下角 footer 快捷按钮已按用户要求移除（入口并入 settings 分节与工作区）。
				const flowResults = [];
				for (const flowName of ["sidebar.workspaces.directoryFlow", "conversation.hero.workspace.directoryFlow"]) {
					try {
						const r = ctx.slots.inject(flowName, () => ctx.slots.register({
							name: flowName,
							id: "madazi-project-flow",
							priority: -1,
							locale: NS,
							inject: () => ({})
						}, ProjectDirectoryFlow));
						flowResults.push(flowName + ":" + (r ? "ok" : "fail"));
					} catch (e) {
						flowResults.push(flowName + ":" + String((e && e.message) || e));
					}
				}
				window.__madaziFlowRegistered = flowResults.join(";");
				const settingsResult = ctx.slots.inject("settings.section", () => ctx.slots.register({
						name: "settings.section",
						id: "madazi-platform",
						order: 30,
						label: () => "平台",
						locale: NS,
						inject: () => ({
							onOpenProject: openProjectWorkspace
						})
						}, PlatformSection));
				// M2 模板市场分节（所有登录用户）：浏览/搜索/安装/评分
				// ★ label「模板市场」与官方「插件」「插件市场」均不同名（settings.section 按 label 去重）
				let mktSectionResult = null;
				try {
					mktSectionResult = ctx.slots.inject("settings.section", () => ctx.slots.register({
						name: "settings.section",
						id: "madazi-template-market",
						order: 32,
						label: () => "模板市场",
						locale: NS,
						inject: () => ({
							onOpenProject: openProjectWorkspace
						})
					}, TemplateMarketSection));
				} catch (e) {
					window.__madaziMktErr = String((e && e.message) || e);
				}
					// M4 技能市场分节（所有登录用户）：浏览/搜索/安装/发布
				let skillSectionResult = null;
				try {
					skillSectionResult = ctx.slots.inject("settings.section", () => ctx.slots.register({
						name: "settings.section",
						id: "madazi-skill-market",
						order: 33,
						label: () => "技能市场",
						locale: NS,
						inject: () => ({
							onOpenProject: openProjectWorkspace
						})
					}, SkillMarketSection));
				} catch (e) {
					window.__madaziSkillErr = String((e && e.message) || e);
				}
					// admin 分节（仅管理员可见）：用户 + key 管理
				let adminResult = null;
				try {
					// ★ 身份判定改走浏览器登录 cookie（同源 /api/auth/me，与成员管理浮层同模式）：
					//   原 madaziSvc.getMe() 走 node 半 SVC_TOKEN——token 缺失/过期（JWT 24h）时
					//   getMe 401 → isAdmin=false → 管理与插件市场分节静默消失；
					//   且判定的是服务身份而非当前登录用户，语义错误。
					const meData = await madaziFetch("/auth/me");
					if (meData && meData.error) throw new Error(typeof meData.error === "object" ? JSON.stringify(meData.error) : meData.error);
					const me = meData && meData.user ? meData.user : meData;
					const isAdmin = me && (me.role === "admin" || me.isAdmin);
					window.__madaziIsAdmin = !!isAdmin;
						if (isAdmin) {
							adminResult = ctx.slots.inject("settings.section", () => ctx.slots.register({
								name: "settings.section",
								id: "madazi-admin",
								order: 40,
								label: () => "管理",
								locale: NS,
								inject: () => ({})
							}, AdminSection));
							// S7 插件市场分节：仅 admin（后端 /api/admin/plugins adminOnly）
							// ★ label 不能与官方「插件」分节同名（settings.section 按 label 去重，同名被官方吃掉）
							ctx.slots.inject("settings.section", () => ctx.slots.register({
								name: "settings.section",
								id: "madazi-market",
								order: 35,
								label: () => "插件市场",
								locale: NS,
								inject: () => ({})
							}, MarketSection));
						}
					} catch (e) {
						window.__madaziAdminErr = String((e && e.message) || e);
					}
					window.__madaziInjected = "settings:" + (settingsResult ? "ok" : "fail") + ";mkt:" + (mktSectionResult ? "ok" : "fail") + ";admin:" + (adminResult ? "ok" : (window.__madaziIsAdmin ? "fail" : "skip"));
				// S6-official 预览控制：已按用户要求撤出对话框（conversation.input.right 不再注册）。
				// PreviewControl 组件保留（含历史下拉+启停），新位置待拍板（settings.section / sidebar 行）。
				// 启用方式：取消下行注释并指定 name 即可。
				// const pvResult = ctx.slots.inject("SETTINGS_OR_SIDEBAR", () => ctx.slots.register({...}, PreviewControl));
			} catch (e) {
				window.__madaziErr = String((e && e.stack) || e);
			}
		}

// ═══════════════════════════════════════════════════════════════
// src/16-preview-control.js
// ═══════════════════════════════════════════════════════════════
		/**
	 * S6-official 预览控制（零注入试水）：注册到官方 conversation.input.right 槽
	 * （输入区工具行右侧，list 孔）。取代 IIFE 段 ctlBtn 的 DOM hack——
	 * 启动/停止预览 + 状态圆点。projectId 来源 = 当前 workspace path
	 * （/app/generated/<id>，与 openProjectWorkspace 约定一致），
	 * 不依赖地址栏 DOM。打开/导航仍走官方浏览器视图（无第三方导航 API）。
	 */
	// S6-official：内部 ErrorBoundary——捕获 Button（primitives）在 slot 孔内的渲染错误，
	// 不连累整个 slot（官方 lu boundary 会吞掉并渲染 data-slot-error 占位）
	class PVBoundary extends react.Component {
		constructor(p) { super(p); this.state = { failed: null }; }
		static getDerivedStateFromError(e) { return { failed: String((e && e.message) || e) }; }
		render() { return this.state.failed ? null : this.props.children; }
	}

	const PV_HIS_KEY = "madazi.previewHistory";
	const PV_MAX_HIS = 10;
	const pvLoadHistory = () => {
		try { return JSON.parse(localStorage.getItem(PV_HIS_KEY) || "[]"); } catch (e) { return []; }
	};
	const pvSaveHistory = (list) => {
		try { localStorage.setItem(PV_HIS_KEY, JSON.stringify(list.slice(0, PV_MAX_HIS))); } catch (e) { /* ignore */ }
	};
	const pvPushHistory = (item) => {
		const list = pvLoadHistory().filter((x) => x.id !== item.id);
		list.unshift({ name: item.name || "项目", id: item.id, t: Date.now() });
		pvSaveHistory(list);
	};

	// S6-official：useWorkspaces hook 崩溃源实锤（w is not a function，store hook 在 slot 上下文不可用）
	// → 改走官方 workspaces client service 快照（window.__madaziWs = ctx.workspaces，非 hook，零崩溃）
	// 预览控制组：历史/项目下拉（切换预览目标）+ 状态圆点 + 启停按钮，全走 madazi RPC
	const PreviewControl = (props) => {
		const [pid, setPid] = useState(null);
		const [options, setOptions] = useState([]); // [{id,name,hist}]
		const [running, setRunning] = useState(null); // null=未知
		const [busy, setBusy] = useState(false);
		const svc = window.__madaziSvc || null;
		const ws = window.__madaziWs || null;

		// 合并候选：localStorage 历史（优先）+ 当前工作区快照项目
		const collect = () => {
			const out = [];
			const seen = {};
			const push = (id, name, hist) => {
				if (!id || seen[id]) return;
				seen[id] = 1;
				out.push({ id, name: name || id.slice(0, 8), hist: !!hist });
			};
			pvLoadHistory().forEach((x) => push(x.id, x.name, true));
			try {
				if (ws && ws.list && typeof ws.list.getSnapshot === "function") {
					const snap = ws.list.getSnapshot();
					const items = (snap && (snap.items || snap.workspaces || snap.list)) || [];
					items.forEach((w) => {
						const path = w && (w.path || w.dir || "");
						const m = path && path.match(/\/generated\/([^/]+)$/);
						if (m) push(m[1], w.title || w.name || null, false);
					});
				}
			} catch (e) { /* ignore */ }
			return out;
		};

		useEffect(() => {
			const apply = () => {
				const list = collect();
				setOptions(list);
				// 优先当前激活工作区（快照 recentWorkspaceId）；否则保持现有选择；否则候选第一条
				let preferred = null;
				try {
					if (ws && ws.list && typeof ws.list.getSnapshot === "function") {
						const snap = ws.list.getSnapshot();
						const recent = snap && (snap.recentWorkspaceId || snap.current);
						if (recent) {
							const items = (snap && (snap.items || snap.workspaces || snap.list)) || [];
							const cur = items.find((w) => w && (w.id === recent || w.workspaceId === recent));
							const path = cur && (cur.path || cur.dir || "");
							const m = path && path.match(/\/generated\/([^/]+)$/);
							if (m) preferred = m[1];
						}
					}
				} catch (e) { /* ignore */ }
				setPid((cur) => (preferred || (cur && list.some((o) => o.id === cur) ? cur : (list[0] ? list[0].id : null))));
			};
			apply();
			let unsub = null;
			try { if (ws && ws.list && typeof ws.list.subscribe === "function") unsub = ws.list.subscribe(apply); } catch (e) { /* ignore */ }
			return () => { if (unsub) { try { unsub(); } catch (e) { /* ignore */ } } };
		}, []);

		// 状态查询 + 15s 周期兜底（外部停止/超时后按钮不刷新）
		useEffect(() => {
			if (!pid || !svc) { setRunning(null); return; }
			let alive = true;
			const q = () => {
				svc.previewStatus(pid).then((d) => {
					if (!alive) return;
					const v = d && d.ok ? d.value : d;
					setRunning(!!(v && (v.running || v.status === "running")));
				}).catch(() => { if (alive) setRunning(null); });
			};
			q();
			const iv = setInterval(q, 15000);
			return () => { alive = false; clearInterval(iv); };
		}, [pid]);

		const act = (fn) => {
			if (!pid || busy) return;
			setBusy(true);
			fn(pid).then((d) => {
				const v = d && d.ok ? d.value : d;
				if (v && v.running !== undefined) setRunning(!!v.running);
				else if (v && v.status) setRunning(v.status === "running");
				pvPushHistory({ id: pid, name: (options.find((o) => o.id === pid) || {}).name || null });
				setBusy(false);
			}).catch(() => { setBusy(false); });
		};
		const onPick = (e) => {
			const v = e && e.target && e.target.value;
			if (!v) return;
			setPid(v);
			setRunning(null);
		};
		const runningText = running ? "停止预览" : (running === null ? "预览…" : "启动预览");
		const targetFn = svc ? (running ? svc.previewStop : svc.previewStart) : null; // render 阶段安全求值（svc 为 null 时不崩）
		return h(PVBoundary, null,
			h("div", {
				style: { display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 6 },
				title: pid ? (((options.find((o) => o.id === pid) || {}).name || pid) + " 预览控制") : "未识别预览项目"
			},
			h(Button, {
				size: "small",
				disabled: !pid || busy || !targetFn,
				onClick: () => { if (targetFn) act(targetFn); }
			}, runningText),
			h("span", { style: { width: 6, height: 6, borderRadius: 999, background: running ? "var(--dsw-alias-state-success-primary,#34C759)" : (running === null ? "#8b949e" : "var(--dsw-alias-state-warning-primary,#FF9F0A)"), display: "inline-block", flex: "0 0 auto" } }),
			h("select", {
				value: pid || "",
				onChange: onPick,
				disabled: !options.length,
				style: { maxWidth: 140, fontSize: 12, height: 26, borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2, #333)", background: "var(--dsw-alias-bg-base, #1e1e1e)", color: "var(--dsw-alias-label-primary, #e0e0e0)" }
			}, options.map((o) => h("option", { key: o.id, value: o.id }, (o.hist ? "◷ " : "") + o.name)))
			)
		);
	};
	exports.MadaziPanel = MadaziPanel;
		exports.ProjectDirectoryFlow = ProjectDirectoryFlow;
		exports.ProjectsEntry = ProjectsEntry;
		exports.PlatformSection = PlatformSection;
		exports.AdminSection = AdminSection;
		exports.apply = apply;
		exports.inject = inject;

// ═══════════════════════════════════════════════════════════════
// src/17-market.js
// ═══════════════════════════════════════════════════════════════
		// S7 插件市场组件。★ 必须定义在 factory 闭包内：它使用闭包内解构的
		// useState/useEffect/react/madaziFetch 等，放在闭包外会 ReferenceError
		// （useState is not defined）。
		const MarketSection = ({ close }) => {
			const [installed, setInstalled] = useState(null);
			const [q, setQ] = useState("");
			const [results, setResults] = useState(null);
			const [searching, setSearching] = useState(false);
			const [prechecks, setPrechecks] = useState({});
			const [busyName, setBusyName] = useState(null);
			const [msg, setMsg] = useState(null);
			// ★ 市场数据层直连 server API（浏览器同源 cookie 鉴权，与成员管理浮层同模式）：
			//   原 window.__madaziSvc.marketXxx 走 node 半 SVC_TOKEN（缺失/24h 过期即 401），
			//   且 market 组 RPC 在 typert 契约文件（typert.host.js / TYPERT_REMOTE）中未登记，路由 404。
			const mkt = (path, opts) => madaziFetch(path, opts).then((d) => {
				if (d && d.error) throw new Error(typeof d.error === "object" ? JSON.stringify(d.error) : d.error);
				return d;
			});
			const loadInstalled = () => {
				mkt("/admin/plugins").then((v) => {
					setInstalled(Array.isArray(v) ? v : (v && v.plugins) || []);
				}).catch((e) => setMsg({ type: "err", text: "已装列表加载失败: " + String((e && e.message) || e) }));
			};
			useEffect(() => { loadInstalled(); }, []);
			const doSearch = () => {
				if (!q.trim() || searching) return;
				setSearching(true); setResults(null); setMsg(null);
				mkt("/admin/plugins/search?q=" + encodeURIComponent(q.trim())).then((v) => {
					setResults(Array.isArray(v) ? v : (v && v.results) || []);
				}).catch((e) => setMsg({ type: "err", text: "搜索失败: " + String((e && e.message) || e) })).finally(() => setSearching(false));
			};
			const doPrecheck = (name) => {
				setPrechecks((prev) => ({ ...prev, [name]: { loading: true } }));
				mkt("/admin/plugins/precheck?name=" + encodeURIComponent(name)).then((v) => {
					setPrechecks((prev) => ({ ...prev, [name]: v }));
				}).catch((e) => setPrechecks((prev) => ({ ...prev, [name]: { error: String((e && e.message) || e) } })));
			};
			const doInstall = (name, version) => {
				if (busyName) return;
				setBusyName(name); setMsg(null);
				mkt("/admin/plugins/install", { method: "POST", body: JSON.stringify(version ? { name, version } : { name }) }).then((v) => {
					if (v && v.ok === false && v.rollback) {
						setMsg({ type: "err", text: "安装失败（verify 未通过已自动回滚）: " + ((v.verify && v.verify.detail) || "").slice(0, 200) });
					} else if (v && v.ok === false) {
						setMsg({ type: "err", text: "安装失败: " + String((v.error || (v.verify && v.verify.detail) || "")).slice(0, 200) });
					} else {
						setMsg({ type: "ok", text: "已安装 " + name + (v && v.version ? " (" + v.version + ")" : "") + (v && v.verify && v.verify.ok ? " ✓ 握手验证通过" : "") + "——点下方「重启 dsh-web 生效」使其进入启动树" });
					}
					loadInstalled();
				}).catch((e) => setMsg({ type: "err", text: "安装失败: " + String((e && e.message) || e) })).finally(() => setBusyName(null));
			};
			const doToggle = (name, enable) => {
				mkt("/admin/plugins/" + (enable ? "enable" : "disable"), { method: "POST", body: JSON.stringify({ name }) }).then((v) => {
					setMsg({ type: v && v.ok === false ? "err" : "ok", text: v && v.ok === false ? ("操作失败: " + (v.error || "")) : (enable ? "已启用 " + name : "已停用 " + name) });
					loadInstalled();
				}).catch((e) => setMsg({ type: "err", text: String((e && e.message) || e) }));
			};
			const doUninstall = (name) => {
				if (busyName) return;
				setBusyName(name); setMsg(null);
				mkt("/admin/plugins/uninstall", { method: "POST", body: JSON.stringify({ name }) }).then((v) => {
					setMsg({ type: v && v.ok === false ? "err" : "ok", text: v && v.ok === false ? ("卸载失败: " + (v.error || "")) : "已卸载 " + name });
					loadInstalled();
				}).catch((e) => setMsg({ type: "err", text: "卸载失败: " + String((e && e.message) || e) })).finally(() => setBusyName(null));
			};
			// ★ 重启 dsh-web 使新装插件进 boot 树（dsh web 进程缓存旧树，不重启不生效）。
			//   DELETE pod → deployment 自动重建；轮询就绪期间 /api/admin/* 走 traefik
			//   平台家族直达 server，不经过 dsh-web pod，本页轮询不受重启影响。
			const [restartState, setRestartState] = useState(null);
			const [restartConfirm, setRestartConfirm] = useState(false);
			const doRestart = () => {
				if (restartState) return;
				setRestartConfirm(false);
				setRestartState("waiting"); setMsg(null);
				mkt("/admin/plugins/restart", { method: "POST" }).then(() => {
					const t0 = Date.now();
					const fail = () => { setRestartState(null); setMsg({ type: "err", text: "等待重启超时（90s），请检查 pod 状态后重试" }); };
					const poll = () => {
						mkt("/admin/plugins/restart/status").then((v) => {
							if (v && v.ready) {
								setRestartState(null);
								// ★ Ready 后提示 + 自动刷新：boot 树随页面加载注入，运行中页面不感知新插件
								setMsg({ type: "ok", text: "dsh-web 已重启完成——即将自动刷新加载新插件…" });
								setTimeout(() => window.location.reload(), 2000);
							} else if (Date.now() - t0 > 90000) fail();
							else setTimeout(poll, 1500);
						}).catch(() => { if (Date.now() - t0 > 90000) fail(); else setTimeout(poll, 2000); });
					};
					setTimeout(poll, 1500);
				}).catch((e) => {
					setRestartState(null);
					setMsg({ type: "err", text: "重启失败: " + String((e && e.message) || e) });
				});
			};
			const warnRow = (w) => h("div", { style: { fontSize: 12, color: w && w.level === "red" ? "var(--dsw-alias-state-error-primary,#FF453A)" : "#FFD60A", marginTop: 2 } }, (w && w.text) || "");
			const instRow = (p) => h("div", { key: p.name, className: "madazi-settings-row" },
				h("div", { className: "madazi-settings-row-main" },
					h("div", { className: "madazi-settings-row-n" }, p.name),
					h("div", { className: "madazi-settings-row-d" }, "v" + (p.version || "?") + (p.enabled ? " · 已启用" : " · 已停用") + (p.active ? " · " + p.active : ""))
				),
				h("div", { style: { display: "flex", gap: 6, alignItems: "center" } },
					h("button", { className: "madazi-settings-open", onClick: () => doToggle(p.name, !p.enabled) }, p.enabled ? "停用" : "启用"),
					h("button", { className: "madazi-btn-danger", onClick: () => doUninstall(p.name), disabled: !!busyName }, "卸载")
				)
			);
			const resRow = (r) => {
				const pc = prechecks[r.name];
				return h("div", { key: r.name, className: "madazi-settings-row", style: { flexDirection: "column", alignItems: "stretch", gap: 6 } },
					h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 } },
						h("div", { className: "madazi-settings-row-main" },
							h("div", { className: "madazi-settings-row-n" }, r.name),
							h("div", { className: "madazi-settings-row-d" }, ((r.description || "")).slice(0, 80) + (r.version ? " · v" + r.version : ""))
						),
						h("div", { style: { display: "flex", gap: 6, alignItems: "center" } },
							h("button", { className: "madazi-settings-open", onClick: () => doPrecheck(r.name) }, "预检"),
							h("button", { className: "madazi-settings-open", onClick: () => doInstall(r.name), disabled: !!busyName }, busyName === r.name ? "安装中…" : "安装")
						)
					),
					pc ? (pc.loading ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } }, "预检中…")
						: pc.error ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, "预检失败: " + pc.error)
							: h("div", null, [
								h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } }, "latest: " + (pc.latest || "-") + (pc.next ? " · next: " + pc.next : "")),
								(pc.warnings || []).map(warnRow)
							])) : null
				);
			};
			return h("div", { className: "madazi-settings" },
				h("div", { className: "madazi-settings-hd" },
					h("div", null,
						h("div", { className: "madazi-settings-title" }, "插件"),
						h("div", { className: "madazi-settings-sub" }, "DSH 插件市场 · npmmirror · 一键安装（自动回滚）")
					),
					h("button", { className: "madazi-settings-refresh", onClick: loadInstalled }, "刷新")
				),
				msg ? h("div", { style: { fontSize: 12, padding: "6px 8px", marginBottom: 8, borderRadius: 6, background: msg.type === "ok" ? "rgba(52,199,89,.1)" : "rgba(255,69,58,.12)", color: msg.type === "ok" ? "var(--dsw-alias-state-success-primary,#34C759)" : "var(--dsw-alias-state-error-primary,#FF453A)" } }, msg.text) : null,
				h("div", { className: "madazi-settings-list", style: { flexDirection: "column", gap: 8 } },
					h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
						h(Input, { value: q, placeholder: "搜索插件（包名/关键词）…", onChange: (e) => setQ(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") doSearch(); }, style: { flex: 1 } }),
						h(Button, { variant: "primary", size: "sm", onClick: doSearch, disabled: searching }, searching ? "搜索中…" : "搜索")
					),
					results === null ? null
						: results.length === 0 ? h("div", { className: "madazi-pop-d" }, "无匹配结果")
							: results.map(resRow)
				),
				h("div", { className: "madazi-settings-list" },
						h("div", { className: "madazi-settings-row", style: { flexDirection: "column", alignItems: "stretch", gap: 8 } },
						h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 } },
							h("div", { className: "madazi-settings-row-n" }, "已安装"),
							h("button", { className: "madazi-settings-open", onClick: () => setRestartConfirm(true), disabled: !!restartState, style: restartState ? { opacity: 0.6 } : null },
								restartState ? "重启中… (pod 重建)" : "⟳ 重启 dsh-web 生效")
						),
							installed === null ? h("div", { className: "madazi-pop-d" }, "加载中…")
								: installed.length === 0 ? h("div", { className: "madazi-pop-d" }, "暂无已装插件")
									: installed.map(instRow)
						)
					),
				// ★ 重启确认弹窗（复用 madazi-flow-overlay/dialog + members-hd 既有样式，替代原生 confirm）
				restartConfirm ? h("div", { className: "madazi-flow-overlay", onClick: () => setRestartConfirm(false) },
					h("div", { className: "madazi-flow-dialog", onClick: (e) => e.stopPropagation() },
						h("div", { className: "madazi-members-hd" }, "重启 dsh-web"),
						h("div", { style: { padding: "14px 16px", fontSize: 12.5, lineHeight: 1.9, color: "var(--dsw-alias-label-secondary)" } },
							h("div", null, "重启使新装插件进入启动树（运行中的进程缓存旧树，重启后新页面才会加载）。"),
							h("div", { style: { color: "var(--dsw-alias-state-warning-primary,#FF9F0A)" } }, "· 正在运行的 AI 会话会被中断，约 15 秒恢复，历史会话保留"),
							h("div", null, "· 在线用户会短暂看到加载页，连接自动恢复"),
							h("div", { style: { color: "var(--dsw-alias-label-tertiary)" } }, "· 完成后本页将自动刷新以加载新插件")
						),
						h("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", padding: "10px 16px", borderTop: "1px solid var(--dsw-alias-border-l1)" } },
							h("button", { className: "madazi-btn-ghost", onClick: () => setRestartConfirm(false) }, "取消"),
							h("button", { className: "madazi-btn-pri", onClick: doRestart }, "确认重启")
						)
					)
				) : null
			);
			};

		// ─────────────────────────────────────────────────────────────
		// M2 模板市场（doc/2026-08-23-模板市场设计.md）：浏览/搜索/分类/排序
		// + 详情（README/版本）+ 一键安装为新项目 + 评分。
		// 数据层直连 server API（浏览器同源 cookie 鉴权，与插件市场同模式）：
		//   GET  /api/market/templates?search&category&sort&mine&limit
		//   GET  /api/market/templates/:slug          → 详情（versions/readme/my_rating）
		//   POST /api/market/templates/:slug/install  {name, version?} → project
		//   POST /api/market/templates/:slug/rate     {score: 1-5}
		// ─────────────────────────────────────────────────────────────
		const MKT_SORTS = [
			{ id: "popular", label: "最多下载" },
			{ id: "newest", label: "最新发布" },
			{ id: "rating", label: "最高评分" },
		];
		const mktFetch = (path, opts) => madaziFetch(path, opts).then((d) => {
			if (d && d.error) throw new Error(typeof d.error === "object" ? JSON.stringify(d.error) : d.error);
			return d;
		});
		const mktBadge = (t) => t.source_type === "official" ? h("span", { className: "madazi-mkt-badge official" }, "官方")
			: t.status === "pending" ? h("span", { className: "madazi-mkt-badge pending" }, "审核中")
				: t.visibility === "private" ? h("span", { className: "madazi-mkt-badge private" }, "私有")
					: h("span", { className: "madazi-mkt-badge community" }, "社区");
		const mktDate = (v) => { try { return new Date(v).toLocaleDateString("zh-CN"); } catch { return ""; } };
		// patch 版本号递增（详情页「发布新版本」默认值）
		const bumpPatch = (v) => {
			const m = String(v || "").match(/^(\d+)\.(\d+)\.(\d+)/);
			return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : "1.0.0";
		};

		// ─────────────────────────────────────────────────────────────
		// M3 发布为模板向导：项目 → 密钥扫描 → zip 打包 → 上架。
		//   POST /api/market/templates/publish
		//   { projectId, name, description, category, tags[], visibility, version, changelog }
		// ★ 原生 fetch（非 madaziFetch）：422 响应体需带 findings 全量字段逐条展示
		// prefill（详情页「发布新版本」）：{ projectId, name, description, category, tags, visibility, nextVersion }
		// ─────────────────────────────────────────────────────────────
		const PublishTemplateModal = ({ project, prefill, onClose }) => {
			const projName = (project && (project.name || project.title)) || "";
			const [name, setName] = useState((prefill && prefill.name) || projName || "");
			const [desc, setDesc] = useState((prefill && prefill.description) || (project && project.description) || "");
			const [category, setCategory] = useState((prefill && prefill.category) || "fullstack");
			const [tagsStr, setTagsStr] = useState(prefill && Array.isArray(prefill.tags) ? prefill.tags.join(", ") : "");
			const [visibility, setVisibility] = useState((prefill && prefill.visibility) || "private");
			const [version, setVersion] = useState((prefill && prefill.nextVersion) || "1.0.0");
			const [changelog, setChangelog] = useState("");
			const [busy, setBusy] = useState(false);
			const [err, setErr] = useState(null);
			const [findings, setFindings] = useState(null);
			const [truncated, setTruncated] = useState(false);
			const [okResult, setOkResult] = useState(null);
			const projectId = (prefill && prefill.projectId) || (project && project.id);

			const submit = async () => {
				if (busy) return;
				if (!name.trim()) { setErr("模板名称不能为空"); return; }
				if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version.trim())) { setErr("版本号需为 semver 格式（如 1.0.0）"); return; }
				setBusy(true); setErr(null); setFindings(null); setTruncated(false); setOkResult(null);
				try {
					const resp = await fetch("/api/market/templates/publish", {
						method: "POST",
						credentials: "same-origin",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							projectId,
							name: name.trim(),
							description: desc.trim(),
							category,
							tags: tagsStr.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
							visibility,
							version: version.trim(),
							changelog: changelog.trim(),
						}),
					});
					const j = await resp.json().catch(() => ({}));
					if (!resp.ok) {
					// ★ 409 版本冲突：自动递增 patch 号，用户直接再点发布即可
					if (resp.status === 409 && j.latest_version) {
						const next = bumpPatch(j.latest_version);
						setVersion(next);
						setErr("版本已存在，已自动递增为 " + next + "，请重新点击发布");
					} else {
						setErr(j.error || ("HTTP " + resp.status));
					}
					if (Array.isArray(j.findings)) setFindings(j.findings);
					if (j.truncated) setTruncated(true);
					return;
				}
					setOkResult(j);
				} catch (e) {
					setErr(String((e && e.message) || e));
				} finally {
					setBusy(false);
				}
			};

			// ── 发布成功态 ──
			if (okResult) {
				const t = okResult.template || {}, v = okResult.version || {};
				const warns = Array.isArray(okResult.scanWarnings) ? okResult.scanWarnings : [];
				return h(Modal, {
					open: true, onClose, title: "发布成功", closeLabel: "关闭",
					footer: h("div", { style: { display: "flex", gap: 8 } },
						h(Button, { variant: "ghost", size: "md", onClick: onClose }, "完成")),
					children: h("div", { className: "madazi-mkt-ok" },
						h("div", { className: "t" }, t.visibility === "public" ? "已提交，等待审核" : "已上架（私有，仅自己可见）"),
						h("div", null, "标识：", h("b", null, t.slug), " · 版本 v" + v.version),
						h("div", { style: { color: "var(--dsw-alias-label-secondary)" } },
							(v.file_count || 0) + " 个文件 · " + ((v.pkg_size || 0) / 1024 / 1024).toFixed(2) + " MB"
							+ (t.visibility === "public" ? " · 审核通过后全员可见" : " · 可在市场「我的模板」中查看")),
						warns.length > 0 ? h("div", { style: {
							marginTop: 12, padding: "10px 12px", borderRadius: 8,
							background: "rgba(255, 180, 0, 0.12)",
							border: "1px solid rgba(255, 180, 0, 0.4)",
							color: "var(--dsw-alias-state-warning-primary,#FF9F0A)", fontSize: 13, lineHeight: 1.6,
						} },
							h("div", { style: { fontWeight: 600 } }, "已发布，但检出 " + warns.length + " 处疑似密钥内容（未阻断，模板内仍保留，请注意清理）："),
							h("ul", { style: { margin: "6px 0 0", paddingLeft: 18 } },
								warns.slice(0, 20).map((w, i) => h("li", { key: i },
									(w.file || "") + (w.line ? ":" + w.line : "") + " · " + (w.label || "") + "（" + (w.match || "") + "）"))),
							okResult.scanTruncated ? h("div", { style: { marginTop: 4, opacity: 0.8 } }, "…更多命中已省略") : null,
						) : null,
					),
				});
			}

			return h(Modal, {
				open: true, onClose, title: (prefill ? "发布新版本" : "发布为模板") + (projName ? " · " + projName : ""), closeLabel: "关闭",
				footer: h("div", { style: { display: "flex", gap: 8 } },
					h(Button, { variant: "ghost", size: "md", onClick: onClose, disabled: busy }, "取消"),
					h(Button, { variant: "primary", size: "md", onClick: submit, disabled: busy }, busy ? "发布中…" : "发布")),
				children: h("div", { className: "madazi-pub-form" },
					h("div", null,
						h("label", null, "模板名称"),
						h("input", { className: "madazi-inp", value: name, onChange: (e) => setName(e.target.value), placeholder: "市场卡片显示的名称", disabled: busy })),
					h("div", null,
						h("label", null, "描述"),
						h("textarea", { className: "madazi-inp", value: desc, onChange: (e) => setDesc(e.target.value), placeholder: "一句话介绍这个模板（可选）", rows: 2, disabled: busy })),
					h("div", { style: { display: "flex", gap: 8 } },
						h("div", { style: { flex: 1 } },
							h("label", null, "分类"),
							h("select", { className: "madazi-sel", value: category, onChange: (e) => setCategory(e.target.value), disabled: busy },
								h("option", { value: "fullstack" }, "全栈 fullstack"),
								h("option", { value: "miniapp" }, "小程序 miniapp"),
								h("option", { value: "admin" }, "管理后台 admin"),
								h("option", { value: "library" }, "组件库 library"))),
						h("div", { style: { flex: 1 } },
							h("label", null, "版本号（semver）"),
							h("input", { className: "madazi-inp", value: version, onChange: (e) => setVersion(e.target.value), placeholder: "1.0.0", disabled: busy }))),
					h("div", null,
						h("label", null, "标签（逗号分隔，最多 10 个）"),
						h("input", { className: "madazi-inp", value: tagsStr, onChange: (e) => setTagsStr(e.target.value), placeholder: "例如：Vue, SpringBoot, 审批流", disabled: busy })),
					h("div", null,
						h("label", null, "可见性"),
						h("div", { className: "madazi-mkt-chips", style: { marginTop: 4 } },
							h("button", { type: "button", className: "madazi-mkt-chip" + (visibility === "private" ? " on" : ""), onClick: () => setVisibility("private"), disabled: busy }, "私有 · 发布即上架"),
							h("button", { type: "button", className: "madazi-mkt-chip" + (visibility === "public" ? " on" : ""), onClick: () => setVisibility("public"), disabled: busy }, "公开 · 需审核")),
						h("div", { className: "madazi-pub-hint" }, "发布前自动执行密钥扫描（证书 / AK-SK / API Key 等命中即拒绝）；README.md 与源码一并打包，安装时还原为新项目。")),
					h("div", null,
						h("label", null, "更新说明（changelog，可选）"),
						h("textarea", { className: "madazi-inp", value: changelog, onChange: (e) => setChangelog(e.target.value), placeholder: "本版本改了什么…", rows: 2, disabled: busy })),
					err ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, err) : null,
					findings ? h("div", { className: "madazi-mkt-findings" },
						findings.map((f, i) => h("div", { key: i, className: "madazi-mkt-finding" },
							h("div", { className: "fl" }, (f.label || f.rule || "命中") + (f.line ? " · 第 " + f.line + " 行" : "")),
							h("div", { className: "ff" }, f.file || ""),
							f.match ? h("div", { className: "ff", style: { fontFamily: "ui-monospace,Menlo,monospace" } }, f.match) : null)),
						truncated ? h("div", { className: "madazi-pub-hint" }, "命中过多，仅展示前若干条…") : null) : null,
			),
		});
	};

	/** ★ 常驻发布向导宿主：侧栏官方菜单（纯 DOM 注入）触发的「发布为模板」走独立
	 *  React root（react-dom/client createRoot），不依赖 ProjectsEntry 挂载——
	 *  ProjectsEntry 仅在「添加项目」弹窗打开时存在，此前事件派发后无人监听。
	 *  挂载点：apply() 里（所有 const 初始化完成后），login 插件同模式。 */
	const PublishHost = () => {
		const [proj, setProj] = useState(null);
		useEffect(() => {
			const onPub = (e) => {
				if (e && e.detail && e.detail.id) setProj(e.detail);
			};
			window.addEventListener("madazi-publish-template", onPub);
			return () => window.removeEventListener("madazi-publish-template", onPub);
		}, []);
		return proj ? h(PublishTemplateModal, { project: proj, onClose: () => setProj(null) }) : null;
	};

		/** 市场浏览器（可复用）：settings 分节与「添加项目」目录流共用。
		 *  onInstalled(project)：安装成功回调（宿主决定打开工作区/关闭弹窗）。 */
		const TemplateMarketBrowser = ({ onInstalled }) => {
			const [list, setList] = useState(null);
			const [q, setQ] = useState("");
			const [category, setCategory] = useState("");
			const [sort, setSort] = useState("popular");
			const [mine, setMine] = useState(false);
			const [err, setErr] = useState(null);
			const [loading, setLoading] = useState(false);
			const [me, setMe] = useState(null); // M3：作者判定（发布新版本/下架仅作者+admin）
			const [pubPrefill, setPubPrefill] = useState(null); // M3：详情页「发布新版本」向导
			// 详情态
			const [detailSlug, setDetailSlug] = useState(null);
			const [detail, setDetail] = useState(null);
			const [detailErr, setDetailErr] = useState(null);
			// 安装态
			const [instName, setInstName] = useState("");
			const [instVer, setInstVer] = useState(null);
			const [instBusy, setInstBusy] = useState(false);
			const [instErr, setInstErr] = useState(null);
			// 评分态
			const [rateScore, setRateScore] = useState(0);
			const [rateMsg, setRateMsg] = useState(null);

			const loadList = (over = {}) => {
				setLoading(true); setErr(null);
				const p = Object.assign({ search: q.trim(), category, sort, mine }, over);
				const qs = new URLSearchParams();
				if (p.search) qs.set("search", p.search);
				if (p.category) qs.set("category", p.category);
				if (p.sort) qs.set("sort", p.sort);
				if (p.mine) qs.set("mine", "1");
				qs.set("limit", "60");
				mktFetch("/market/templates?" + qs.toString()).then((v) => {
					setList(Array.isArray(v) ? v : []);
				}).catch((e) => setErr(String((e && e.message) || e))).finally(() => setLoading(false));
			};
			useEffect(() => { loadList(); }, []);
			// M3：当前用户（作者判定）
			useEffect(() => {
				mktFetch("/auth/me").then((v) => {
					const u = v && v.user ? v.user : v;
					if (u && u.id) setMe(u);
				}).catch(() => {});
			}, []);
			// M3：作者/管理员可下架（official 不可）
			const doArchive = () => {
				if (!detailSlug) return;
				if (!window.confirm("确认下架该模板？已安装的项目不受影响。")) return;
				mktFetch("/market/templates/" + encodeURIComponent(detailSlug) + "/archive", { method: "POST" }).then(() => {
					setDetailSlug(null); setDetail(null); loadList();
				}).catch((e) => setDetailErr(String((e && e.message) || e)));
			};
			const openDetail = (slug) => {
				setDetailSlug(slug); setDetail(null); setDetailErr(null);
				setInstErr(null); setRateMsg(null); setInstVer(null);
				mktFetch("/market/templates/" + encodeURIComponent(slug)).then((d) => {
					setDetail(d);
					setInstName(d.name || "");
					setRateScore(d.my_rating ? d.my_rating.score : 0);
				}).catch((e) => setDetailErr(String((e && e.message) || e)));
			};
			const doRate = (score) => {
				if (!detailSlug) return;
				setRateScore(score);
				mktFetch("/market/templates/" + encodeURIComponent(detailSlug) + "/rate", {
					method: "POST", body: JSON.stringify({ score }),
				}).then(() => {
					setRateMsg("感谢评分！");
					// 刷新详情（rating_avg / rating_count / my_rating 回显）
					mktFetch("/market/templates/" + encodeURIComponent(detailSlug)).then((d) => setDetail(d)).catch(() => {});
				}).catch((e) => setRateMsg("评分失败: " + String((e && e.message) || e)));
			};
			const doInstall = () => {
				if (instBusy) return;
				if (!instName.trim()) { setInstErr("项目名称不能为空"); return; }
				setInstBusy(true); setInstErr(null);
				const body = { name: instName.trim() };
				if (instVer) body.version = instVer;
				mktFetch("/market/templates/" + encodeURIComponent(detailSlug) + "/install", {
					method: "POST", body: JSON.stringify(body),
				}).then((proj) => {
					if (onInstalled) return Promise.resolve(onInstalled(proj));
				}).catch((e) => setInstErr("安装失败: " + String((e && e.message) || e)))
					.finally(() => setInstBusy(false));
			};

			// ── 详情视图 ──
			if (detailSlug) {
				const selVer = instVer || (detail && detail.versions && detail.versions[0] && detail.versions[0].version);
				// M3：作者（或 admin）可管理；官方模板不可
				const isOwner = detail && me && (detail.author_id === me.id || window.__madaziIsAdmin);
				const canManage = isOwner && detail.source_type !== "official" && detail.status !== "archived";
				return h("div", { className: "madazi-settings" },
					h("div", { className: "madazi-settings-hd" },
						h("div", null,
							h("div", { className: "madazi-settings-title" }, detail ? detail.name : "模板详情"),
							detail ? h("div", { className: "madazi-settings-sub" },
								detail.slug + " · ↓ " + (detail.download_count || 0)
								+ " · ★ " + (detail.rating_avg ? Number(detail.rating_avg).toFixed(1) : "-") + (detail.rating_count ? " (" + detail.rating_count + ")" : "")
								+ " · " + mktDate(detail.updated_at || detail.created_at)
							) : null
						),
						h("div", { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" } },
							canManage && detail.origin_project_id ? h(Button, {
								variant: "ghost", size: "sm", title: "从来源项目重新打包发布新版本",
								onClick: () => setPubPrefill({
									projectId: detail.origin_project_id,
									name: detail.name,
									description: detail.description,
									category: detail.category,
									tags: detail.tags,
									visibility: detail.visibility,
									nextVersion: bumpPatch(detail.latest_version || (detail.versions && detail.versions[0] && detail.versions[0].version)),
								}),
							}, "发布新版本") : null,
							canManage ? h(Button, { variant: "ghost", size: "sm", onClick: doArchive, title: "下架后市场不再展示" }, "下架") : null,
							h(Button, { variant: "ghost", size: "sm", onClick: () => { setDetailSlug(null); setDetail(null); loadList(); } }, "返回市场"))
					),
					detailErr ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, detailErr)
						: !detail ? h("div", { className: "madazi-pop-d" }, "加载中…")
							: h("div", { style: { display: "flex", flexDirection: "column", gap: 10 } },
								detail.readme ? h("div", { className: "madazi-mkt-readme" }, detail.readme) : null,
								h("div", null,
									h("div", { className: "madazi-settings-row-n" }, "版本"),
									h("div", { className: "madazi-mkt-vers" },
										(detail.versions || []).length === 0 ? h("div", { className: "madazi-pop-d" }, "暂无可用版本")
											: (detail.versions || []).map((v) => h("button", {
												key: v.id, type: "button",
												className: "madazi-mkt-ver" + (selVer === v.version ? " on" : ""),
												onClick: () => setInstVer(v.version),
												title: v.status === "rejected" && v.review_note ? "已驳回：" + v.review_note : "选择此版本安装",
											},
												h("span", { className: "v" }, "v" + v.version
													+ (v.status === "pending" ? " · 审核中" : "")
													+ (v.status === "rejected" ? " · 已驳回" : "")),
												h("span", { className: "c" }, v.changelog || mktDate(v.created_at))
											)))
								),
								h("div", null,
									h("div", { className: "madazi-settings-row-n" }, "评分"),
									h("div", { className: "madazi-mkt-stars" },
										[1, 2, 3, 4, 5].map((s) => h("span", {
											key: s, className: "madazi-mkt-star" + (s <= rateScore ? " on" : ""),
											onClick: () => doRate(s), title: s + " 星",
										}, "★"))),
									rateMsg ? h("div", { style: { fontSize: 11, marginTop: 4, color: rateMsg.indexOf("失败") === -1 ? "var(--dsw-alias-state-success-primary,#34C759)" : "var(--dsw-alias-state-error-primary,#FF453A)" } }, rateMsg) : null
								),
								h("div", null,
									h("div", { className: "madazi-settings-row-n" }, "安装为新项目"),
									h("div", { className: "madazi-mkt-install-row" },
										h(Input, { value: instName, placeholder: "新项目名称…", onChange: (e) => setInstName(e.target.value), style: { flex: 1 } }),
										h(Button, { variant: "primary", size: "md", disabled: instBusy, onClick: doInstall }, instBusy ? "安装中…" : "安装")
									),
									instErr ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)", marginTop: 6 } }, instErr) : null
								)
							),
					// M3：发布新版本向导（发布成功后刷新详情 + 列表）
					pubPrefill ? h(PublishTemplateModal, {
						prefill: pubPrefill,
						onClose: () => { setPubPrefill(null); openDetail(detailSlug); loadList(); },
					}) : null
				);
			}

			// ── 列表视图 ──
			const cats = [];
			for (const t of list || []) if (t.category && cats.indexOf(t.category) === -1) cats.push(t.category);
			const cardRow = (t) => h("button", { key: t.id, type: "button", className: "madazi-mkt-card", onClick: () => openDetail(t.slug) },
				h("div", { className: "madazi-mkt-card-hd" },
					h("span", { className: "madazi-mkt-icon" }, (t.name || "?").slice(0, 2)),
					h("span", { className: "madazi-mkt-name" }, t.name || t.slug),
					mktBadge(t)
				),
				t.description ? h("div", { className: "madazi-mkt-desc" }, t.description) : null,
				Array.isArray(t.tags) && t.tags.length ? h("div", { className: "madazi-mkt-tags" }, t.tags.slice(0, 6).map((tag) => h("span", { key: tag }, tag))) : null,
				h("div", { className: "madazi-mkt-meta" },
					h("span", null, "↓ " + (t.download_count || 0)),
					h("span", null, "★ " + (t.rating_avg ? Number(t.rating_avg).toFixed(1) : "-") + (t.rating_count ? " (" + t.rating_count + ")" : "")),
					h("span", null, mktDate(t.updated_at || t.created_at))
				)
			);
			return h("div", null,
				h("div", { className: "madazi-mkt-toolbar" },
					h(Input, {
						value: q, placeholder: "搜索模板名称/描述/标签…",
						onChange: (e) => setQ(e.target.value),
						onKeyDown: (e) => { if (e.key === "Enter") loadList(); },
						style: { flex: 1, minWidth: 160 },
					}),
					h(Button, { variant: "ghost", size: "sm", onClick: () => loadList(), disabled: loading }, loading ? "加载中…" : "搜索"),
					h("select", {
						className: "madazi-mkt-sort", value: sort, title: "排序",
						onChange: (e) => { const v = e.target.value; setSort(v); loadList({ sort: v }); },
					}, MKT_SORTS.map((s) => h("option", { key: s.id, value: s.id }, s.label)))
				),
				h("div", { className: "madazi-mkt-chips" },
					h("button", { type: "button", className: "madazi-mkt-chip" + (category === "" && !mine ? " on" : ""), onClick: () => { setCategory(""); setMine(false); loadList({ category: "", mine: false }); } }, "全部"),
					cats.map((c) => h("button", { key: c, type: "button", className: "madazi-mkt-chip" + (category === c && !mine ? " on" : ""), onClick: () => { setCategory(c); setMine(false); loadList({ category: c, mine: false }); } }, c)),
					h("button", { type: "button", className: "madazi-mkt-chip" + (mine ? " on" : ""), onClick: () => { setMine(true); loadList({ mine: true }); } }, "我的模板"),
					h("span", { style: { flex: 1 } }),
					h("button", { type: "button", className: "madazi-mkt-chip", onClick: () => loadList(), title: "重新加载" }, "刷新")
				),
				h("div", { className: "madazi-mkt-list" },
					err ? h("div", { style: { padding: 12, fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, err)
						: list === null ? h("div", { className: "madazi-pop-d" }, "加载中…")
							: list.length === 0 ? h("div", { className: "madazi-pop-d" }, mine ? "你还没有发布过模板" : "暂无模板")
								: list.map(cardRow)
				)
			);
		};

		/** M2 模板市场 settings 分节（所有登录用户可浏览/安装/评分；发布入口在项目工作区） */
		const TemplateMarketSection = ({ close, onOpenProject }) => {
			return h("div", { className: "madazi-settings" },
				h("div", { className: "madazi-settings-hd" },
					h("div", null,
						h("div", { className: "madazi-settings-title" }, "模板市场"),
						h("div", { className: "madazi-settings-sub" }, "官方与社区项目模板 · 一键安装为新项目")
					)
				),
				h(TemplateMarketBrowser, {
					onInstalled: async (proj) => {
						if (onOpenProject) await onOpenProject(proj);
						if (close) close();
					},
				})
			);
		};
		// ★ 导出必须放在 const 定义之后（TDZ：exports 段在前会 Cannot access before initialization）
		exports.TemplateMarketBrowser = TemplateMarketBrowser;
		exports.TemplateMarketSection = TemplateMarketSection;

// ═══════════════════════════════════════════════════════════════
// src/18-skills.js
// ═══════════════════════════════════════════════════════════════
		// M4 技能市场（SkillMarketSection）：浏览/搜索/安装平台共享技能。
		// 数据层直连 server API（浏览器同源 cookie 鉴权，与成员管理浮层同模式）：
		//   GET  /api/skills           市场列表（is_public）
		//   GET  /api/skills/:id       详情（含 prompt 正文）
		//   POST /api/skills/:id/install/:projectId   安装到项目（写 .agents/skills/<slug>.md）
		//   POST /api/skills           发布技能
		//   GET  /api/projects         项目列表（安装目标）
		// 官方 dsh-skill-filesystem 自动发现 .agents/skills/*.md，安装即生效；DSH 技能名只认 kebab-case（/slug 触发）。
		const SkillMarketBrowser = ({ onInstalled, t }) => {
			const [list, setList] = useState(null);
			const [err, setErr] = useState(null);
			const [q, setQ] = useState("");
			const [category, setCategory] = useState("");
			const [detailId, setDetailId] = useState(null);
			const [detail, setDetail] = useState(null);
			const [detailErr, setDetailErr] = useState(null);
			const [projects, setProjects] = useState(null);
			const [instProj, setInstProj] = useState("");
			const [instBusy, setInstBusy] = useState(false);
			const [instMsg, setInstMsg] = useState(null);
			// 发布表单
			const [pubOpen, setPubOpen] = useState(false);
			const [pub, setPub] = useState({ name: "", slug: "", description: "", icon: "sparkles", color: "#5E6AD2", category: "general", prompt: "", is_builtin: false });
			const [pubBusy, setPubBusy] = useState(false);
			const [pubMsg, setPubMsg] = useState(null);
			const [isAdmin, setIsAdmin] = useState(false);

			const sapi = (path, opts) => madaziFetch(path, opts).then((d) => {
				if (d && d.error) throw new Error(typeof d.error === "object" ? JSON.stringify(d.error) : d.error);
				return d;
			});

			const loadList = (over = {}) => {
				setErr(null);
				const params = [];
				if (over.q !== undefined ? over.q : q) params.push("q=" + encodeURIComponent(over.q !== undefined ? over.q : q));
				if (over.category !== undefined ? over.category : category) params.push("category=" + encodeURIComponent(over.category !== undefined ? over.category : category));
				const qs = params.length ? "?" + params.join("&") : "";
				sapi("/skills" + qs).then((v) => {
					let arr = Array.isArray(v) ? v : [];
					// ★ 后端列表接口尚未实现 q/category 过滤，前端兜底过滤
					const kw = (over.q !== undefined ? over.q : q || "").toLowerCase();
					const cat = (over.category !== undefined ? over.category : category || "");
					if (kw || cat) arr = arr.filter((s) => {
						const okCat = !cat || (s.category || "") === cat;
						const okKw = !kw || ((s.name || "") + " " + (s.description || "")).toLowerCase().indexOf(kw) !== -1;
						return okCat && okKw;
					});
					setList(arr);
				}).catch((e) => setErr(String((e && e.message) || e)));
			};
			useEffect(() => { loadList(); }, []);
			// 身份判定：是否管理员（决定发布表单是否显示"官方内置"开关）
			useEffect(() => {
				madaziFetch("/auth/me").then((d) => {
					const me = d && (d.user || d);
					setIsAdmin(!!(me && (me.role === "admin" || me.isAdmin)));
				}).catch(() => {});
			}, []);

			const loadProjects = () => {
				if (projects !== null) return;
				sapi("/projects").then((v) => setProjects(Array.isArray(v) ? v : [])).catch(() => setProjects([]));
			};

			const openDetail = (id) => {
				// ★ 安装默认当前项目（_currentProjectId 经 _madaziCtx 反查；无则回退手选）
				const curProj = (typeof _currentProjectId === "function" && _madaziCtx) ? (_currentProjectId(_madaziCtx) || "") : "";
				setDetailId(id); setDetail(null); setDetailErr(null); setInstMsg(null); setInstProj(curProj);
				loadProjects();
				sapi("/skills/" + id).then((v) => setDetail(v)).catch((e) => setDetailErr(String((e && e.message) || e)));
			};

			const doInstall = () => {
				if (!instProj || instBusy || !detailId) return;
				setInstBusy(true); setInstMsg(null);
				sapi("/skills/" + detailId + "/install/" + instProj, { method: "POST" }).then((v) => {
					if (v && v.ok === false) setInstMsg({ type: "err", text: "安装失败: " + (v.error || "") });
					else {
						const slug = (detail && detail.slug) || (detail && detail.name || "");
						setInstMsg({ type: "ok", text: "已安装「" + (detail && detail.name || "") + "」——对话中输入 /" + slug + " 可触发" });
						loadList();
					}
				}).catch((e) => setInstMsg({ type: "err", text: "安装失败: " + String((e && e.message) || e) })).finally(() => setInstBusy(false));
			};

			const doPublish = () => {
				if (pubBusy) return;
				if (!pub.name.trim() || !pub.prompt.trim()) { setPubMsg({ type: "err", text: "名称和技能内容不能为空" }); return; }
				setPubBusy(true); setPubMsg(null);
				sapi("/skills", { method: "POST", body: JSON.stringify(pub) }).then((v) => {
					if (v && v.error) setPubMsg({ type: "err", text: "发布失败: " + v.error });
					else {
						setPubMsg({ type: "ok", text: "已发布「" + v.name + "」" + (v.is_builtin ? "（官方内置，全项目可用）" : "，可在市场安装") });
						setPubOpen(false);
						setPub({ name: "", slug: "", description: "", icon: "sparkles", color: "#5E6AD2", category: "general", prompt: "", is_builtin: false });
						loadList();
					}
				}).catch((e) => setPubMsg({ type: "err", text: "发布失败: " + String((e && e.message) || e) })).finally(() => setPubBusy(false));
			};

			// ── 详情视图 ──
			if (detailId !== null) {
				return h("div", null,
					h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } },
						h("div", { className: "madazi-settings-title" }, "技能详情"),
						h(Button, { variant: "ghost", size: "sm", onClick: () => { setDetailId(null); setDetail(null); } }, "返回市场")
					),
					detailErr ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, detailErr)
						: !detail ? h("div", { className: "madazi-pop-d" }, "加载中…")
							: h("div", { style: { display: "flex", flexDirection: "column", gap: 12 } },
								h("div", { className: "madazi-settings-row" },
									h("div", { className: "madazi-settings-row-main" },
										h("div", { className: "madazi-settings-row-n" }, detail.name || detail.id),
										h("div", { className: "madazi-settings-row-d" }, (detail.description || "无描述") + " · 作者 " + (detail.author_name || "?") + " · 安装 " + (detail.install_count || 0)),
									)
								),
								detail.prompt ? h("div", { className: "madazi-mkt-readme" }, detail.prompt) : null,
								detail.is_builtin
									? h("div", { className: "madazi-mkt-builtin-tip" },
										h("div", null, "内置技能：已在所有项目全局生效，无需安装"),
										h("div", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary)", marginTop: 4 } }, "在任意项目对话中输入 /" + (detail.slug || "") + " 即可触发")
									)
									: h("div", null,
										h("div", { className: "madazi-settings-row-n" }, "安装到项目"),
										h("div", { className: "madazi-mkt-install-row" },
											h("select", {
												className: "madazi-sel", value: instProj, style: { flex: 1 },
												onChange: (e) => setInstProj(e.target.value),
												disabled: projects === null,
											},
												h("option", { value: "" }, projects === null ? "加载项目…" : "选择项目…"),
												(projects || []).map((p) => h("option", { key: p.id, value: p.id }, p.name || p.id.slice(0, 8)))
											),
											h(Button, { variant: "primary", size: "md", disabled: instBusy || !instProj, onClick: doInstall }, instBusy ? "安装中…" : "安装")
										),
										instMsg ? h("div", { style: { fontSize: 12, marginTop: 6, color: instMsg.type === "ok" ? "var(--dsw-alias-state-success-primary,#34C759)" : "var(--dsw-alias-state-error-primary,#FF453A)" } }, instMsg.text) : null
									)
							)
				);
			}

			// ── 发布表单 ──
			if (pubOpen) {
				const field = (label, val, set, placeholder, textarea) =>
					h("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
						h("label", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary)" } }, label),
						textarea
							? h("textarea", { className: "madazi-inp", rows: 8, value: val, placeholder, onChange: (e) => set(e.target.value), style: { fontFamily: "ui-monospace,Menlo,monospace", fontSize: 12 } })
							: h("input", { className: "madazi-inp", value: val, placeholder, onChange: (e) => set(e.target.value) })
					);
				return h("div", null,
					h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } },
						h("div", { className: "madazi-settings-title" }, "发布技能"),
						h(Button, { variant: "ghost", size: "sm", onClick: () => { setPubOpen(false); setPubMsg(null); } }, "取消")
					),
					h("div", { className: "madazi-pub-form" },
						field("名称 *", pub.name, (v) => setPub({ ...pub, name: v }), "如：代码审查助手"),
						field("英文标识（对话中 /xxx 触发，kebab-case 小写字母数字连字符；可留空）", pub.slug, (v) => setPub({ ...pub, slug: v }), "如：code-review"),
						field("描述", pub.description, (v) => setPub({ ...pub, description: v }), "一句话说明这个技能的用途"),
						h("div", { style: { display: "flex", gap: 8 } },
							field("分类", pub.category, (v) => setPub({ ...pub, category: v }), "如：code-review / frontend / test"),
						),
						isAdmin ? h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
							h("input", { type: "checkbox", id: "madazi-pub-builtin", checked: !!pub.is_builtin, onChange: (e) => setPub({ ...pub, is_builtin: e.target.checked }) }),
							h("label", { htmlFor: "madazi-pub-builtin", style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } }, "发布为官方内置（所有项目自动可用，无需安装）")
						) : null,
						field("技能内容 *（markdown，发给 AI 的指令）", pub.prompt, (v) => setPub({ ...pub, prompt: v }), "## 角色\n…\n\n## 任务\n…", true),
						pubMsg ? h("div", { style: { fontSize: 12, color: pubMsg.type === "ok" ? "var(--dsw-alias-state-success-primary,#34C759)" : "var(--dsw-alias-state-error-primary,#FF453A)" } }, pubMsg.text) : null,
						h(Button, { variant: "primary", size: "md", disabled: pubBusy, onClick: doPublish }, pubBusy ? "发布中…" : "发布")
					)
				);
			}

			// ── 列表视图 ──
			const cats = [];
			for (const s of list || []) if (s.category && cats.indexOf(s.category) === -1) cats.push(s.category);
			const cardRow = (s) => h("button", { key: s.id, type: "button", className: "madazi-mkt-card", onClick: () => openDetail(s.id) },
				h("div", { className: "madazi-mkt-card-hd" },
					h("span", { className: "madazi-mkt-icon", style: s.color ? { background: (s.color || "#5E6AD2") + "22", color: s.color } : undefined }, (s.name || "?").slice(0, 2)),
					h("span", { className: "madazi-mkt-name" }, s.name || s.id),
					s.is_builtin ? h("span", { className: "madazi-mkt-badge builtin" }, "内置") : null,
					h("span", { className: "madazi-mkt-badge official" }, s.category || "general")
				),
				s.description ? h("div", { className: "madazi-mkt-desc" }, s.description) : null,
				h("div", { className: "madazi-mkt-meta" },
					h("span", null, "↓ " + (s.install_count || 0)),
					h("span", null, "作者 " + (s.author_name || "?"))
				)
			);
			return h("div", null,
				h("div", { className: "madazi-mkt-toolbar" },
					h(Input, {
						value: q, placeholder: "搜索技能名称/描述…",
						onChange: (e) => setQ(e.target.value),
						onKeyDown: (e) => { if (e.key === "Enter") loadList(); },
						style: { flex: 1, minWidth: 160 },
					}),
					h(Button, { variant: "ghost", size: "sm", onClick: () => loadList(), disabled: list === null }, "搜索"),
					h(Button, { variant: "ghost", size: "sm", onClick: () => { setPubOpen(true); setPubMsg(null); } }, "发布技能")
				),
				h("div", { className: "madazi-mkt-chips" },
					h("button", { type: "button", className: "madazi-mkt-chip" + (category === "" ? " on" : ""), onClick: () => { setCategory(""); loadList({ category: "" }); } }, "全部"),
					cats.map((c) => h("button", { key: c, type: "button", className: "madazi-mkt-chip" + (category === c ? " on" : ""), onClick: () => { setCategory(c); loadList({ category: c }); } }, c)),
					h("span", { style: { flex: 1 } }),
					h("button", { type: "button", className: "madazi-mkt-chip", onClick: () => loadList(), title: "重新加载" }, "刷新")
				),
				h("div", { className: "madazi-mkt-list" },
					err ? h("div", { style: { padding: 12, fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, err)
						: list === null ? h("div", { className: "madazi-pop-d" }, "加载中…")
							: list.length === 0 ? h("div", { className: "madazi-pop-d" }, "暂无技能，点右上角「发布技能」分享第一个吧")
								: list.map(cardRow)
				)
			);
		};

		/** M4 技能市场 settings 分节（所有登录用户可见） */
		const SkillMarketSection = ({ close, onOpenProject }) => {
			return h("div", { className: "madazi-settings" },
				h("div", { className: "madazi-settings-hd" },
					h("div", null,
						h("div", { className: "madazi-settings-title" }, "技能市场"),
						h("div", { className: "madazi-settings-sub" }, "内置技能全项目自动可用 · 团队技能安装到项目后对话中直接触发")
					)
				),
				h(SkillMarketBrowser, { onInstalled: onOpenProject })
			);
		};

		exports.SkillMarketSection = SkillMarketSection;

// ═══════════════════════════════════════════════════════════════
// src/19-share-skill.js
// ═══════════════════════════════════════════════════════════════
	// ── 分享技能到市场（对话里 /分享技能） ──────────────────────────
	// 三级体系的人工确认链路：AI 在对话里用 skill-creator 沉淀出项目私有技能
	// （.agents/skills/*.md）→ 用户 /分享技能 → 浮层列表 → 确认后写 skills 表（市场），
	// 其他用户即可安装到自己的项目。安全：模型写出的内容先留在项目沙箱，人工确认才公开。
	// 数据：GET  /api/skills/project/:projectId   项目私有技能列表
	//       POST /api/skills/project/:projectId/:fileName/share   分享到市场
	const _escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

	const openShareSkillOverlay = (projectId) => {
		if (document.querySelector(".madazi-share-overlay")) return;
		const ov = document.createElement("div");
		ov.className = "madazi-share-overlay";
		ov.innerHTML =
			'<div class="madazi-share-dialog">' +
				'<div class="madazi-share-hd"><span class="madazi-share-title">分享技能到市场</span>' +
					'<button type="button" class="madazi-members-close" data-share-close="1" title="关闭">✕</button></div>' +
				'<div class="madazi-share-body" data-share-body="1"><div class="madazi-members-load">加载项目技能…</div></div>' +
				'<div class="madazi-share-foot" data-share-msg="1"></div>' +
			"</div>";
		document.body.appendChild(ov);
		const close = () => ov.remove();
		ov.querySelector("[data-share-close]").addEventListener("click", close);
		ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
		const bodyEl = ov.querySelector("[data-share-body]");
		const msgEl = ov.querySelector("[data-share-msg]");
		const say = (type, text) => { msgEl.textContent = text; msgEl.style.color = type === "ok" ? "var(--dsw-alias-state-success-primary,#34C759)" : "var(--dsw-alias-state-error-primary,#FF453A)"; };
		madaziFetch("/skills/project/" + projectId).then((skills) => {
			const arr = Array.isArray(skills) ? skills : [];
			if (!arr.length) {
				bodyEl.innerHTML = '<div class="madazi-members-load">当前项目还没有技能。在对话里对 AI 说「用 skill-creator 帮我沉淀一个 XX 技能」即可生成项目技能。</div>';
				return;
			}
			bodyEl.innerHTML = "";
			arr.forEach((s) => {
				const fileName = (s.fileName || s.id.replace(/^custom-/, "") + ".md").replace(/\.md$/, "");
				const row = document.createElement("div");
				row.className = "madazi-share-row";
				row.innerHTML =
					'<div class="madazi-share-row-main">' +
						'<div class="madazi-settings-row-n">' + _escHtml(s.name) + ' <span style="font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary)">' + _escHtml(fileName) + "</span></div>" +
						'<div class="madazi-settings-row-d">' + _escHtml(s.description || "无描述") + "</div>" +
					"</div>" +
					'<div class="madazi-share-acts" style="justify-content:flex-start">' +
						'<button type="button" class="madazi-btn-ghost" data-share-btn="1">分享到市场</button>' +
					"</div>" +
					'<div class="madazi-share-form" data-share-form="1" hidden>' +
						'<input class="madazi-inp" data-f="name" placeholder="市场展示名（可填中文）" value="' + _escHtml(s.name) + '">' +
						'<input class="madazi-inp" data-f="desc" placeholder="一句话描述" value="' + _escHtml(s.description || "") + '">' +
						'<input class="madazi-inp" data-f="cat" placeholder="分类（如 code-review / testing）" value="' + _escHtml(s.category || "general") + '">' +
						'<div class="madazi-share-acts">' +
							'<button type="button" class="madazi-pop-btn primary" data-confirm="1">确认分享</button>' +
							'<button type="button" class="madazi-pop-btn" data-cancel="1">取消</button>' +
						"</div>" +
					"</div>";
				row.querySelector("[data-share-btn]").addEventListener("click", () => {
					const form = row.querySelector("[data-share-form]");
					form.hidden = !form.hidden;
				});
				row.querySelector("[data-cancel]").addEventListener("click", () => {
					row.querySelector("[data-share-form]").hidden = true;
				});
				row.querySelector("[data-confirm]").addEventListener("click", () => {
					const name = row.querySelector('[data-f="name"]').value.trim() || s.name;
					const desc = row.querySelector('[data-f="desc"]').value.trim();
					const cat = row.querySelector('[data-f="cat"]').value.trim() || "general";
					const btn = row.querySelector("[data-confirm]");
					btn.disabled = true; btn.textContent = "分享中…";
					madaziFetch("/skills/project/" + projectId + "/" + encodeURIComponent(fileName) + "/share", {
						method: "POST",
						body: JSON.stringify({ displayName: name, description: desc, category: cat, is_builtin: false }),
					}).then((d) => {
						if (d && d.error) { say("err", "分享失败: " + d.error); btn.disabled = false; btn.textContent = "确认分享"; return; }
						say("ok", "已分享「" + name + "」到市场，其他用户可安装");
						row.remove();
					}).catch((e) => {
						say("err", "分享失败: " + ((e && e.message) || e)); btn.disabled = false; btn.textContent = "确认分享";
					});
				});
				bodyEl.appendChild(row);
			});
		}).catch(() => {
			bodyEl.innerHTML = '<div class="madazi-members-load">加载项目技能失败</div>';
		});
	};

	// 注册 /分享技能 斜杠源（挂在官方 skill(2) 之后、ultra-slash(100) 之前）
	const installShareSkillSlash = (ctx) => {
		if (window.__madaziShareSkillInstalled) return;
		const svc = (ctx.inputTriggers && typeof ctx.inputTriggers.registerSource === "function")
			? ctx.inputTriggers
			: (typeof ctx.get === "function" ? ctx.get("inputTriggers") : null);
		if (!svc || typeof svc.registerSource !== "function") { console.warn("[madazi] inputTriggers 不可用，/分享技能 未注册"); return; }
		const source = {
			trigger: "/",
			name: "madazi-share-skill",
			order: 95,
			candidates: async (_session, req) => {
				const q = String((req && req.query) || "").trim();
				const pid = (typeof _currentProjectId === "function") ? _currentProjectId(ctx) : null;
				if (!pid) return [];
				if (q === "" || "分享技能".indexOf(q) !== -1) return [{ name: "分享技能", description: "把当前项目的技能发布到市场，供其他用户安装" }];
				return [];
			},
			onPick: () => {
				const pid = (typeof _currentProjectId === "function") ? _currentProjectId(ctx) : null;
				if (pid) openShareSkillOverlay(pid);
				return undefined; // 不落地输入框文本，直接打开分享浮层
			},
		};
		try {
			svc.registerSource(source);
			window.__madaziShareSkillInstalled = true;
		} catch (e) { console.warn("[madazi] /分享技能 注册失败:", e); }
	};

// ═══════════════════════════════════════════════════════════════
// src/20-skill-market-overlay.js
// ═══════════════════════════════════════════════════════════════
	// ── 技能市场浮层（/ 面板头部固定入口 + /技能市场 兜底）──────────────────
	// 零官方 patch：面板头部入口用 DOM 注入（MutationObserver 定位 role=listbox，
	// 插入固定 header，React 重渲染移走则重插）；点开全屏浮层复用市场 API
	// （GET /skills 列表 / GET /skills/:id 详情 / POST .../install/:projectId 安装 /
	// POST /skills 发布）。安装默认当前项目（_currentProjectId）。
	// 数据接口与 18-skills.js 的 SkillMarketBrowser 同源（浏览器同域 cookie 鉴权）。

	const openSkillMarketOverlay = () => {
		if (document.querySelector(".madazi-mkt-overlay")) return;
		const ov = document.createElement("div");
		ov.className = "madazi-mkt-overlay";
		ov.innerHTML =
			'<div class="madazi-mkt-dialog">' +
				'<div class="madazi-mkt-hd"><span class="madazi-mkt-title">技能市场</span>' +
					'<button type="button" class="madazi-members-close" data-mkt-close="1" title="关闭">✕</button></div>' +
				'<div class="madazi-mkt-body" data-mkt-body="1"><div class="madazi-members-load">加载技能市场…</div></div>' +
				'<div class="madazi-mkt-msg" data-mkt-msg="1"></div>' +
			"</div>";
		document.body.appendChild(ov);
		const bodyEl = ov.querySelector("[data-mkt-body]");
		const msgEl = ov.querySelector("[data-mkt-msg]");
		const close = () => ov.remove();
		ov.querySelector("[data-mkt-close]").addEventListener("click", close);
		ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
		const say = (type, text) => { msgEl.textContent = text; msgEl.style.color = type === "ok" ? "var(--dsw-alias-state-success-primary,#34C759)" : "var(--dsw-alias-state-error-primary,#FF453A)"; };

		const curProject = () => (typeof _currentProjectId === "function" && _madaziCtx) ? (_currentProjectId(_madaziCtx) || "") : "";
		const sapi = (path, opts) => madaziFetch(path, opts).then((d) => { if (d && d.error) throw new Error(typeof d.error === "object" ? JSON.stringify(d.error) : d.error); return d; });

		const S = { view: "list", list: null, err: null, q: "", category: "", detail: null, projects: null, instProj: curProject(), instBusy: false, pubOpen: false, pub: { name: "", slug: "", description: "", icon: "sparkles", color: "#5E6AD2", category: "general", prompt: "", is_builtin: false }, pubBusy: false, isAdmin: false };

		const loadList = () => {
			say("", ""); S.err = null;
			sapi("/skills").then((v) => {
				const arr = Array.isArray(v) ? v : [];
				const kw = S.q.trim().toLowerCase(), cat = S.category;
				S.list = arr.filter((s) => (!cat || (s.category || "") === cat) && (!kw || ((s.name || "") + " " + (s.description || "")).toLowerCase().indexOf(kw) !== -1));
				render();
			}).catch((e) => { S.err = String((e && e.message) || e); render(); });
		};
		const loadProjects = () => {
			if (S.projects !== null) return;
			sapi("/projects").then((v) => { S.projects = Array.isArray(v) ? v : []; render(); }).catch(() => { S.projects = []; render(); });
		};
		const openDetail = (id) => {
			S.view = "detail"; S.detail = null; S.instProj = curProject(); say("", "");
			loadProjects();
			sapi("/skills/" + id).then((v) => { S.detail = v; render(); }).catch((e) => { say("err", "加载详情失败: " + ((e && e.message) || e)); });
			render();
		};
		const doInstall = () => {
			if (!S.instProj || S.instBusy || !S.detail) return;
			S.instBusy = true; say("", ""); render();
			sapi("/skills/" + S.detail.id + "/install/" + S.instProj, { method: "POST" }).then((v) => {
				if (v && v.ok === false) say("err", "安装失败: " + (v.error || ""));
				else { say("ok", "已安装「" + (S.detail.name || "") + "」到当前项目——对话中输入 /" + (S.detail.slug || S.detail.name || "") + " 可触发"); loadList(); }
			}).catch((e) => say("err", "安装失败: " + ((e && e.message) || e))).finally(() => { S.instBusy = false; render(); });
		};
		const doPublish = () => {
			if (S.pubBusy || !S.pub.name.trim() || !S.pub.prompt.trim()) { if (!S.pub.name.trim() || !S.pub.prompt.trim()) say("err", "名称和技能内容不能为空"); return; }
			S.pubBusy = true; say("", "");
			sapi("/skills", { method: "POST", body: JSON.stringify(S.pub) }).then((v) => {
				if (v && v.error) say("err", "发布失败: " + v.error);
				else { say("ok", "已发布「" + v.name + "」" + (v.is_builtin ? "（官方内置，全项目可用）" : "，可在市场安装")); S.pubOpen = false; S.pub = { name: "", slug: "", description: "", icon: "sparkles", color: "#5E6AD2", category: "general", prompt: "", is_builtin: false }; loadList(); }
			}).catch((e) => say("err", "发布失败: " + ((e && e.message) || e))).finally(() => { S.pubBusy = false; render(); });
		};

		const btn = (label, cls, onClick, disabled) => { const b = document.createElement("button"); b.type = "button"; b.className = cls || "madazi-pop-btn"; b.textContent = label; if (disabled) b.disabled = true; b.addEventListener("click", onClick); return b; };
		const cardRow = (s) => {
			const c = document.createElement("button");
			c.type = "button"; c.className = "madazi-mkt-card";
			c.innerHTML =
				'<div class="madazi-mkt-card-hd">' +
					'<span class="madazi-mkt-icon" style="' + (s.color ? "background:" + s.color + "22;color:" + s.color : "") + '">' + _escHtml((s.name || "?").slice(0, 2)) + "</span>" +
					'<span class="madazi-mkt-name">' + _escHtml(s.name || s.id) + "</span>" +
					(s.is_builtin ? '<span class="madazi-mkt-badge builtin">内置</span>' : "") +
					'<span class="madazi-mkt-badge official">' + _escHtml(s.category || "general") + "</span>" +
				"</div>" +
				(s.description ? '<div class="madazi-mkt-desc">' + _escHtml(s.description) + "</div>" : "") +
				'<div class="madazi-mkt-meta"><span>↓ ' + (s.install_count || 0) + "</span><span>作者 " + _escHtml(s.author_name || "?") + "</span></div>";
			c.addEventListener("click", () => openDetail(s.id));
			return c;
		};

		const render = () => {
			bodyEl.innerHTML = "";
			if (S.view === "detail" && S.detail) {
				const d = S.detail;
				const wrap = document.createElement("div");
				wrap.style.cssText = "display:flex;flex-direction:column;gap:10px";
				wrap.innerHTML =
					'<div style="display:flex;justify-content:space-between;align-items:center"><div class="madazi-settings-title">技能详情</div></div>' +
					'<div class="madazi-settings-row"><div class="madazi-settings-row-main">' +
						'<div class="madazi-settings-row-n">' + _escHtml(d.name || d.id) + "</div>" +
						'<div class="madazi-settings-row-d">' + _escHtml((d.description || "无描述") + " · 作者 " + (d.author_name || "?") + " · 安装 " + (d.install_count || 0)) + "</div></div></div>" +
					(d.prompt ? '<div class="madazi-mkt-readme" style="max-height:240px;overflow-y:auto">' + _escHtml(d.prompt) + "</div>" : "");
				const backBtn = btn("返回市场", "madazi-btn-ghost", () => { S.view = "list"; render(); });
				wrap.querySelector("div").prepend(backBtn);
				if (d.is_builtin) {
					const tip = document.createElement("div");
					tip.className = "madazi-mkt-builtin-tip";
					tip.innerHTML = "<div>内置技能：已在所有项目全局生效，无需安装</div><div style='font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:4px'>在任意项目对话中输入 /" + _escHtml(d.slug || "") + " 即可触发</div>";
					wrap.appendChild(tip);
				} else {
					const row = document.createElement("div");
					row.innerHTML = '<div class="madazi-settings-row-n">安装到项目（默认当前项目）</div><div class="madazi-mkt-install-row"></div>';
					const sel = document.createElement("select");
					sel.className = "madazi-sel"; sel.style.flex = "1";
					const opts = (S.projects || []).map((p) => ({ id: p.id, name: p.name || p.id.slice(0, 8) }));
					const cur = curProject();
					if (!opts.some((o) => o.id === cur)) { opts.unshift({ id: "", name: "选择项目…" }); }
					opts.forEach((o) => { const opt = document.createElement("option"); opt.value = o.id; opt.textContent = o.name; if (o.id === S.instProj) opt.selected = true; sel.appendChild(opt); });
					sel.addEventListener("change", () => { S.instProj = sel.value; });
					row.querySelector(".madazi-mkt-install-row").appendChild(sel);
					row.querySelector(".madazi-mkt-install-row").appendChild(btn(S.instBusy ? "安装中…" : "安装", "madazi-pop-btn primary", doInstall, S.instBusy || !S.instProj));
					wrap.appendChild(row);
				}
				bodyEl.appendChild(wrap);
				return;
			}
			if (S.view === "detail") { bodyEl.innerHTML = '<div class="madazi-members-load">加载详情…</div>'; return; }
			if (S.pubOpen) {
				const wrap = document.createElement("div");
				wrap.style.cssText = "display:flex;flex-direction:column;gap:8px";
				const f = (label, key, placeholder, textarea) => {
					const box = document.createElement("div");
					box.style.cssText = "display:flex;flex-direction:column;gap:4px";
					box.innerHTML = '<label style="font-size:11px;color:var(--dsw-alias-label-secondary)">' + _escHtml(label) + "</label>";
					const inp = textarea ? document.createElement("textarea") : document.createElement("input");
					inp.className = "madazi-inp";
					if (textarea) { inp.rows = 8; inp.style.cssText = "font-family:ui-monospace,Menlo,monospace;font-size:12px"; }
					inp.placeholder = placeholder || ""; inp.value = S.pub[key] || "";
					inp.addEventListener("input", () => { S.pub[key] = inp.value; });
					box.appendChild(inp);
					return box;
				};
				wrap.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center"><div class="madazi-settings-title">发布技能</div></div>';
				[["名称 *", "name", "如：代码审查助手"], ["英文标识（/xxx 触发，kebab-case；可留空）", "slug", "如：code-review"], ["描述", "description", "一句话说明用途"]].forEach(([l, k, p]) => wrap.appendChild(f(l, k, p)));
				if (S.isAdmin) {
					const b = document.createElement("div");
					b.style.cssText = "display:flex;align-items:center;gap:8px";
					b.innerHTML = '<label style="font-size:12px;color:var(--dsw-alias-label-secondary)">发布为官方内置（所有项目自动可用）</label>';
					const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!S.pub.is_builtin;
					cb.addEventListener("change", () => { S.pub.is_builtin = cb.checked; });
					b.prepend(cb);
					wrap.appendChild(b);
				}
				wrap.appendChild(f("技能内容 *（markdown，发给 AI 的指令）", "prompt", "## 角色\n…", true));
				const acts = document.createElement("div");
				acts.className = "madazi-mkt-acts";
				acts.appendChild(btn(S.pubBusy ? "发布中…" : "发布", "madazi-pop-btn primary", doPublish, S.pubBusy));
				acts.appendChild(btn("取消", "madazi-pop-btn", () => { S.pubOpen = false; render(); }));
				wrap.appendChild(acts);
				bodyEl.appendChild(wrap);
				return;
			}
			// ── 列表视图 ──
			const cats = [];
			for (const s of S.list || []) if (s.category && cats.indexOf(s.category) === -1) cats.push(s.category);
			const toolbar = document.createElement("div");
			toolbar.className = "madazi-mkt-toolbar";
			const search = document.createElement("input");
			search.className = "madazi-inp"; search.placeholder = "搜索技能名称/描述…"; search.style.cssText = "flex:1;min-width:140px"; search.value = S.q;
			search.addEventListener("keydown", (e) => { if (e.key === "Enter") { S.q = search.value; loadList(); } });
			toolbar.appendChild(search);
			toolbar.appendChild(btn("搜索", "madazi-btn-ghost", () => { S.q = search.value; loadList(); }));
			toolbar.appendChild(btn("发布技能", "madazi-btn-ghost", () => { S.pubOpen = true; render(); }));
			const chips = document.createElement("div");
			chips.className = "madazi-mkt-chips";
			const mkChip = (label, val) => {
				const c = document.createElement("button");
				c.type = "button"; c.className = "madazi-mkt-chip" + (S.category === val ? " on" : ""); c.textContent = label;
				c.addEventListener("click", () => { S.category = val; loadList(); });
				return c;
			};
			chips.appendChild(mkChip("全部", ""));
			cats.forEach((c) => chips.appendChild(mkChip(c, c)));
			const list = document.createElement("div");
			list.className = "madazi-mkt-list";
			if (S.err) list.innerHTML = '<div style="padding:12px;font-size:12px;color:var(--dsw-alias-state-error-primary,#FF453A)">' + _escHtml(S.err) + "</div>";
			else if (S.list === null) list.innerHTML = '<div class="madazi-pop-d">加载中…</div>';
			else if (S.list.length === 0) list.innerHTML = '<div class="madazi-pop-d">暂无技能</div>';
			else S.list.forEach((s) => list.appendChild(cardRow(s)));
			bodyEl.appendChild(toolbar);
			bodyEl.appendChild(chips);
			bodyEl.appendChild(list);
		};

		// 管理员判定（发布表单的"官方内置"开关）
		madaziFetch("/auth/me").then((d) => { const me = d && (d.user || d); S.isAdmin = !!(me && (me.role === "admin" || me.isAdmin)); }).catch(() => {});
		loadList();
		render();
	};

	// / 面板头部固定入口：DOM 注入 role=listbox 顶部（React 重渲染移走则重插）
	// ★ 定位必须精确：页面存在多个 [role=listbox]（如设置面板「提示音」下拉），
	//   只认 / 命令面板（dsh-client-ui-input-trigger MenuView）的 listbox——
	//   特征：class 含 "menu"（MenuView module hash 保留语义名）且非 SoundSettings（提示音）。
	const _findSlashListbox = () => {
		const boxes = Array.from(document.querySelectorAll('[role="listbox"]'));
		for (const b of boxes) {
			const cls = String(b.className || "");
			if (cls.indexOf("menu") === -1) continue;
			const label = String(b.getAttribute("aria-label") || "").toLowerCase();
			if (!label) return b; // MenuView listbox 的 aria-label 由 locale 决定，空时直接认
			if (label.indexOf("sound") !== -1) continue; // SoundSettings 提示音
			if (label.indexOf("提示音") !== -1) continue;
			return b;
		}
		return null;
	};
	const ensureMarketHeader = () => {
		const menu = _findSlashListbox();
		if (!menu || menu.querySelector(".madazi-slash-hd")) return;
		const hd = document.createElement("div");
		hd.className = "madazi-slash-hd";
		hd.innerHTML = '<button type="button" class="madazi-slash-mkt-btn" data-mkt-open="1">技能市场</button><span class="madazi-slash-mkt-hint">浏览/安装到当前项目</span>';
		menu.prepend(hd);
		hd.querySelector("[data-mkt-open]").addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openSkillMarketOverlay(); });
	};
	const installMarketHeaderWatch = () => {
		if (window.__madaziMarketHdInstalled) return;
		window.__madaziMarketHdInstalled = true;
		ensureMarketHeader();
		const mo = new MutationObserver(() => ensureMarketHeader());
		mo.observe(document.body, { childList: true, subtree: true });
	};

	// 兜底入口：/技能市场 斜杠源（order 1，位于官方技能分组之上，纯官方扩展点）
	const installMarketSlash = (ctx) => {
		if (window.__madaziMarketSlashInstalled) return;
		const svc = (ctx.inputTriggers && typeof ctx.inputTriggers.registerSource === "function") ? ctx.inputTriggers : null;
		if (!svc) return;
		try {
			svc.registerSource({
				trigger: "/", name: "madazi-skill-market", order: 1,
				candidates: async (_s, req) => {
					const q = String((req && req.query) || "").trim();
					if (q === "" || "技能市场".indexOf(q) !== -1) return [{ name: "技能市场", description: "打开技能市场（浏览/安装到当前项目）" }];
					return [];
				},
				onPick: () => { openSkillMarketOverlay(); return undefined; },
			});
			window.__madaziMarketSlashInstalled = true;
		} catch (e) { console.warn("[madazi] 技能市场 slash 注册失败:", e); }
	};

// ═══════════════════════════════════════════════════════════════
// src/21-oauth-settings.js
// ═══════════════════════════════════════════════════════════════
		/** OAuth 三方登录配置（仅管理员，2026-08-28）
		 * GET/PUT /admin/oauth：settings 表 oauth_<name> JSON，secret 加密存储 + GET 脱敏。
		 * Secret 留空 = 不修改（后端保留旧值）；保存后 10s 内生效（settings 缓存 TTL）。
		 * 依赖拼接作用域共享的 madaziFetch / h / useState / useEffect。 */
		const OauthSettingsSection = () => {
			const [cfg, setCfg] = useState(null);      // GET 返回（脱敏：无 secret 明文）
			const [secrets, setSecrets] = useState({}); // 独立管理 Secret 输入框
			const [busy, setBusy] = useState(false);
			const [msg, setMsg] = useState(null);
			const [err, setErr] = useState(null);
			const load = () => {
				setErr(null);
				madaziFetch("/admin/oauth").then((v) => {
					if (v && v.error) { setErr(v.error); return; }
					setCfg(v || {});
				}).catch((e) => setErr(String((e && e.message) || e)));
			};
			useEffect(() => { load(); }, []);
			const setOf = (p, k, val) => setCfg((prev) => {
				const next = { ...(prev || {}) };
				next[p] = { ...(next[p] || {}), [k]: val };
				return next;
			});
			const setSecret = (p, val) => setSecrets((prev) => ({ ...prev, [p]: val }));
			const save = async () => {
				setBusy(true); setErr(null); setMsg(null);
				try {
					const body = {};
					for (const p of ["wechat", "wecom", "feishu", "dingtalk"]) {
						const c = (cfg && cfg[p]) || {};
						body[p] = {
							enabled: !!c.enabled,
							appId: (c.appId || "").trim(),
							agentId: (c.agentId || "").trim(),
							secret: (secrets[p] || "").trim(),
						};
					}
					const v = await madaziFetch("/admin/oauth", { method: "PUT", body: JSON.stringify(body) });
					if (v && v.error) { setErr(typeof v.error === "object" ? JSON.stringify(v.error) : v.error); return; }
					setMsg("已保存（最多 10 秒生效）");
					setSecrets({});
					load();
				} catch (e) { setErr(String((e && e.message) || e)); }
				finally { setBusy(false); }
			};
			const META = {
				wechat: { name: "微信", appIdPh: "AppID（开放平台）", agent: false },
				wecom: { name: "企业微信", appIdPh: "CorpID（企业ID）", agent: true },
				feishu: { name: "飞书", appIdPh: "App ID", agent: false },
				dingtalk: { name: "钉钉", appIdPh: "AppKey", agent: false },
			};
			return h("div", { className: "madazi-form", style: { border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 8, flexDirection: "column", alignItems: "stretch", gap: 10 } },
				h("div", { style: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, "三方登录"),
				h("div", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary, #888)" } }, "配置后登录页出现对应扫码入口；Secret 留空 = 不修改（已配置自动保留）"),
				cfg === null
					? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #888)" } }, "加载中…")
					: ["wechat", "wecom", "feishu", "dingtalk"].map((p) => {
						const meta = META[p];
						const c = cfg[p] || {};
						return h("div", { key: p, style: { display: "flex", flexDirection: "column", gap: 6, padding: 8, borderRadius: 8, background: "var(--dsw-alias-bg-base,rgba(0,0,0,.04))" } },
							h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
								h("label", { style: { display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--dsw-alias-label-primary)" } },
									h("input", { type: "checkbox", checked: !!c.enabled, onChange: (e) => setOf(p, "enabled", e.target.checked) }),
									meta.name
								),
								c.hasSecret ? h("span", { style: { fontSize: 11, color: "var(--dsw-alias-state-success-primary,#34C759)" } }, "Secret 已配置") : null
							),
							h("input", { className: "madazi-inp", placeholder: meta.appIdPh, value: c.appId || "", onChange: (e) => setOf(p, "appId", e.target.value) }),
							meta.agent ? h("input", { className: "madazi-inp", placeholder: "AgentID（企业微信应用）", value: c.agentId || "", onChange: (e) => setOf(p, "agentId", e.target.value) }) : null,
							h("input", { className: "madazi-inp", type: "password", placeholder: c.hasSecret ? "App Secret（留空不修改）" : "App Secret", value: secrets[p] || "", onChange: (e) => setSecret(p, e.target.value) })
						);
					}),
				err ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, "API: " + err) : null,
				msg ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-success-primary,#34C759)" } }, msg) : null,
				h("button", { className: "madazi-btn-pri", disabled: busy || cfg === null, onClick: save }, busy ? "保存中…" : "保存")
			);
		};

// ═══════════════════════════════════════════════════════════════
// src/22-browser-agent.js
// ═══════════════════════════════════════════════════════════════
		// ══════════ 内置浏览器 AI 操控（多会话隔离版 2026-09-04）══════════
		// agent 工具(host) → /git/browser-command HTTP 长轮询 → BrowserView iframe postMessage
		// → 注入脚本 __DSH_BROWSER__ 执行(snapshot/click/type/eval/wait/verify_text/screenshot)
		// → agent-result 回传 → POST /git/browser-result → host 工具 resolve
		// 导航类指令(navigate/reload/back/forward)由泵直接控制 iframe，无需注入脚本
		// 体验：AI 操控时显示蓝色呼吸覆盖层 + "Agent 操控中…"，用户可点"我来接管"暂停 AI 操控
		//
		// ★ 多会话隔离（2026-09-04）：同一工作台多个 AI 会话并发浏览器操作。
		//   每个会话一条独立长轮询泵（心跳令牌 = 窗口基 + ":" + sessionId，server activeTabs
		//   按会话存、天然定向派发）；每个会话一个专属 browser tab（Workbench
		//   __madaziBrowserEnsure(sid,url,{activate}) 建/找，window.__madaziBrowserBySession
		//   实时映射），泵按 iframe[data-browser-tab] 靶向自己的窗口——后台会话的 tab 由
		//   EditorPane 隐藏常驻堆保持 iframe 挂载，各会话互不干扰、响应不错乱。
		const BROWSER_AGENT_SOURCE = "dsh-workbench-browser";
		// 窗口级用户接管标志（保留兼容）；多会话 AI 接管用 _takenOver Map（见下）
		const BROWSER_TAKEOVER_KEY = "__madaziBrowserTakenOver";
		let madaziOverlayEl = null;
		let madaziReposTimer = null;

		// ── 泵身份（多会话）──
		// dsh 为共享单实例：同一会话可能多标签/多设备/多用户同时挂泵。每个(窗口,会话)
		// 一个稳定心跳令牌：长轮询带 ?session=<sid>&tab=<令牌>&user=<uid> 注册心跳
		// （user = 本窗口登录用户，host 按此建立「发起者用户 → 窗口」映射）；结果回传带
		// session/tab，host 校验「实际执行窗口」才 resolve。
		// ★ 谁发消息谁控制（2026-09-04）：host 按网关 prompt 拦截记录的发起者（userId）
		//   解析其心跳窗口定向派发——指令/呼吸层/接管按钮只落在发起者窗口，AI 只读
		//   发起者窗口的浏览器结果；其他用户的窗口收不到指令（只看会话消息流）。
		// ★ 令牌与「dsh browser tab id」解耦——browser tab 懒创建，而心跳必须先于首次
		//   指令存在；iframe 定位走 __madaziBrowserBySession → data-browser-tab。
		const _browserSessionId = () => {
			try {
				const ctx = _madaziCtx;
				if (ctx && ctx.sessions && ctx.sessions.list) return ctx.sessions.list.getSnapshot().current || null;
			} catch (e) { /* ignore */ }
			return null;
		};
		const _browserTabIdFor = (sid) => {
			if (!window.__madaziBrowserTab) {
				window.__madaziBrowserTab = "t" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
			}
			return window.__madaziBrowserTab + ":" + (sid || "none");
		};
		// 会话 → dsh browser tab id（Workbench 注入的实时镜像）
		const _browserTabIdOfSession = (sid) => {
			if (!sid) return null;
			try {
				const m = window.__madaziBrowserBySession;
				if (m && typeof m.get === "function") return m.get(sid) || null;
			} catch (e) { /* ignore */ }
			return null;
		};
		// ★ 会话专属 iframe 靶向：优先 data-browser-tab（同项目同 URL 多 tab 唯一可靠区分）
		const findBrowserFrameForSession = (sid) => {
			const tabId = _browserTabIdOfSession(sid);
			if (tabId) {
				try {
					const f = document.querySelector('iframe[data-browser-tab="' + tabId + '"]');
					if (f) return f;
				} catch (e) { /* ignore */ }
				return null; // 绑定存在但 iframe 未挂载（隐藏堆未渲染/加载中）
			}
			// 无绑定兜底：旧全局匹配（兼容非会话触发的浏览器 tab）
			return findBrowserFrame();
		};
		// 旧全局 iframe 定位（兜底用）
		const findBrowserFrame = () => {
			const all = Array.from(document.querySelectorAll("iframe"));
			const pick = (f) => {
				const s = f.getAttribute("src") || "";
				return /browser\/view|pv-|preview-proxy|\/api\/projects\//.test(s)
					|| (() => { try { return !!(f.contentWindow && f.contentWindow.__DSH_BROWSER__); } catch (e) { return false; } })();
			};
			let pid = null;
			try { pid = (typeof _currentProjectId === "function" && _madaziCtx) ? (_currentProjectId(_madaziCtx) || null) : null; } catch (e) { pid = null; }
			if (pid) {
				const pid8 = pid.slice(0, 8).toLowerCase();
				const pfull = pid.toLowerCase();
				const owned = all.filter(pick).find((f) => {
					const s = (f.getAttribute("src") || "").toLowerCase();
					return s.includes("pv-" + pid8) || s.includes("/api/projects/" + pfull);
				});
				if (owned) return owned;
			}
			return all.find(pick) || null;
		};
		// 结果回传：带会话心跳令牌（server 校验活跃响应者）
		const postBrowserResultFor = (id, result, sid) => {
			try {
				fetch("/git/browser-result", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, result, session: sid || "", tab: _browserTabIdFor(sid) }) }).catch(() => {});
			} catch (e) { /* ignore */ }
		};
		// ★ 注入脚本就绪检测：同源 iframe 里 __DSH_BROWSER__ 已挂载才算可用。
		//   navigate/reload 后 iframe 重建、页面加载中、跨域时检测失败 → 指令秒级返回
		//   "页面加载中"（AI 快速重试/先 browser_wait），而不是盲等 20s 后超时。
		const isInjectedReady = (frame) => {
			try {
				return !!(frame && frame.contentWindow && frame.contentWindow.__DSH_BROWSER__);
			} catch (e) { return false; } // 跨域/异常 → 未就绪
		};

		// ── 接管状态（按会话）──
		// 两类接管语义必须区分：
		//   · 用户接管（window[BROWSER_TAKEOVER_KEY]）：用户点「我来接管」抢走浏览器，
		//     AI 指令应被拦截 → _isTakenOver 只检查这一种
		//   · AI 接管（_takenOver）：AI 主动接管浏览器（显示「Agent 操控中」覆盖层），
		//     AI 指令应放行——绝不能用来拦截 AI 自己（否则 AI takeover(start) 自锁，
		//     后续操作全被「用户已接管」拦截 → 锁状态与横幅不一致的根因）
		// ★ 2026-09-04 修复：两类锁都加 TTL 自动过期，防止遗留锁永久阻塞。
		// ★ 2026-09-05 活跃续期：用户接管 TTL 90→120s，且接管期间用户在本页（含预览
		//   iframe 内）有输入 → 节流每 10s 续期本地时间戳 + 重报 server（幂等覆盖）
		//   → 「用户在操作就持有控制」；停止活动 120s（走开）→ 双端过期，AI 自动恢复。
		//   避免固定 TTL 两难：太短打断正在操作的用户（AI 抢鼠标），太长走开后空挂。
		const TAKEOVER_TTL = 120 * 1000;
		const _takenOver = new Map(); // sid -> at(ms)，仅 AI 接管覆盖层显示用
		const _userTakeoverAt = () => {
			try {
				const v = window[BROWSER_TAKEOVER_KEY];
				if (v === true) return Date.now() - TAKEOVER_TTL - 1; // 旧版遗留 true → 视为已过期
				if (typeof v === 'number' && v > 0) return v;
			} catch (e) { /* ignore */ }
			return 0;
		};
		const _isTakenOver = (sid) => {
			const uat = _userTakeoverAt();
			if (uat && Date.now() - uat < TAKEOVER_TTL) return true;
			return false;
		};
		// ★ 2026-09-04 用户接管上报 server（全局按会话）：接管是会话级事实，任何窗口执行
		//   AI 工具都被 server 拒（runCommand 入口），不再受「指令派给哪个窗口」影响。
		const _reportUserTakeover = (action) => {
			const cur = _browserSessionId();
			if (!cur) return;
			try {
				fetch("/git/browser-takeover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: cur, action }) }).catch(() => {});
			} catch (e) { /* ignore */ }
		};
		// ── 2026-09-05 用户接管活跃续期 ──
		// 接管期间用户在本页有输入（指针/键盘/滚轮）→ 节流每 10s：续期本地时间戳 +
		// 重报 server（takeover 幂等时间戳覆盖即续期）。用户在操作 → 一直持有控制；
		// 停止活动 120s（走开）→ 双端过期，AI（waitForUserRelease 轮询）自动恢复。
		// 注意：接管操作多发生在预览 iframe 内（如输密码），iframe 事件不冒泡到父窗口
		// → 除父窗口监听外，还要向同源 iframe 文档挂监听（随泵循环对导航重建自动重挂）。
		const _TAKEOVER_RENEW_MS = 10 * 1000;
		let _lastTakeoverRenewAt = 0;
		const _ACTIVITY_EVENTS = ["pointermove", "pointerdown", "keydown", "wheel"];
		const _renewUserTakeover = () => {
			const uat = _userTakeoverAt();
			if (!uat || Date.now() - uat >= TAKEOVER_TTL) return; // 未接管/已过期 → 不续
			window[BROWSER_TAKEOVER_KEY] = Date.now(); // 续本地
			_reportUserTakeover("takeover"); // 续 server（幂等）
		};
		const _onTakeoverActivity = () => {
			const now = Date.now();
			if (now - _lastTakeoverRenewAt < _TAKEOVER_RENEW_MS) return;
			_lastTakeoverRenewAt = now;
			_renewUserTakeover();
		};
		for (const _ev of _ACTIVITY_EVENTS) {
			document.addEventListener(_ev, _onTakeoverActivity, { passive: true, capture: true });
		}
		// 同源 iframe 内活动监听（跨域壳页挂不上则静默跳过，不影响续期主链路）
		let _takeoverActivityDoc = null;
		const _stopTakeoverActivityTrack = () => {
			if (!_takeoverActivityDoc) return;
			try {
				for (const _ev of _ACTIVITY_EVENTS) _takeoverActivityDoc.removeEventListener(_ev, _onTakeoverActivity, true);
			} catch (e) { /* ignore */ }
			_takeoverActivityDoc = null;
		};
		const _ensureTakeoverActivityTrack = (frame) => {
			let doc = null;
			try { doc = frame && frame.contentWindow && frame.contentWindow.document; }
			catch (e) { doc = null; }
			if (!doc || doc === _takeoverActivityDoc) return;
			_stopTakeoverActivityTrack();
			_takeoverActivityDoc = doc;
			try {
				for (const _ev of _ACTIVITY_EVENTS) doc.addEventListener(_ev, _onTakeoverActivity, true);
			} catch (e) { _takeoverActivityDoc = null; }
		};
		// ★ 2026-09-04 发起者权威化：废弃交互启发式（pointerdown/keydown 上报——任何窗口
		//   随便点一下就会偷走发起者身份，无法区分「发消息」与「旁观点击」）。改为：
		//   1) 网关（madazi-server）拦截 session/prompt，cookie 身份权威识别发起者并推送
		//      host——输入框回车、AI 快捷选择、未来任何发消息入口都汇聚到同一 RPC 拦截点；
		//   2) 本窗口用户身份（/api/auth/me）随心跳 user 参数上报 → host 知道每个用户
		//      在哪个窗口，按发起者解析定向派发：指令/呼吸层/接管按钮只落在发起者窗口。
		let _myUid = "";
		const _loadMyUid = () => {
			if (_myUid) return;
			fetch("/api/auth/me", { credentials: "same-origin" }).then((r) => r.json()).then((j) => {
				const u = j && j.user;
				if (u && u.id) _myUid = String(u.id);
				else setTimeout(_loadMyUid, 30000);
			}).catch(() => { setTimeout(_loadMyUid, 30000); });
		};
		_loadMyUid();

		// ── 接管覆盖层（窗口级单例；仅当前可见会话显示）──
		const madaziOverlayStyleId = "madazi-agent-overlay-style";
		const ensureOverlayStyle = () => {
			if (document.getElementById(madaziOverlayStyleId)) return;
			const st = document.createElement("style");
			st.id = madaziOverlayStyleId;
			st.textContent = [
				"@keyframes madaziAgentPulse{0%,100%{opacity:.18}50%{opacity:.36}}",
				"@keyframes madaziAgentBorder{0%,100%{border-color:rgba(37,99,235,.40);box-shadow:0 0 0 5px rgba(37,99,235,.14),inset 0 0 0 3px rgba(37,99,235,.14)}50%{border-color:rgba(59,130,246,.72);box-shadow:0 0 0 9px rgba(59,130,246,.32),inset 0 0 0 6px rgba(59,130,246,.26)}}",
				"@keyframes madaziAgentClick{0%,100%{transform:translate(-50%,-50%) scale(1)}35%{transform:translate(-50%,-50%) scale(.72)}65%{transform:translate(-50%,-50%) scale(1.08)}}",
				".madazi-agent-overlay{position:fixed;z-index:2147483000;pointer-events:none;background:rgba(37,99,235,.10);border:2px solid rgba(37,99,235,.42);animation:madaziAgentBorder 2.4s ease-in-out infinite;display:none}",
				".madazi-agent-pill{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483001;background:#0A1A3F;color:#fff;font-size:13px;padding:6px 14px;border-radius:16px;display:none;align-items:center;gap:8px;box-shadow:0 2px 12px rgba(0,0,0,.25);pointer-events:none;font-family:system-ui}",
				".madazi-agent-pill .dot{width:8px;height:8px;border-radius:50%;background:#4d9fff;animation:madaziAgentPulse 1.2s ease-in-out infinite}",
				".madazi-agent-takeover{position:fixed;right:20px;bottom:20px;z-index:2147483002;background:#2563eb;color:#fff;border:none;padding:8px 16px;border-radius:8px;font-size:13px;cursor:pointer;box-shadow:0 4px 16px rgba(37,99,235,.4);display:none;pointer-events:auto;font-family:system-ui}",
				".madazi-agent-takeover:hover{background:#1d4ed8}",
				".madazi-agent-badge{position:fixed;right:20px;bottom:20px;z-index:2147483003;background:var(--dsw-alias-state-error-primary,#FF453A);color:#fff;padding:8px 14px;border-radius:8px;font-size:13px;display:none;align-items:center;gap:8px;box-shadow:0 4px 16px rgba(0,0,0,.25);font-family:system-ui}",
				".madazi-agent-badge button{background:#fff;color:var(--dsw-alias-state-error-primary,#FF453A);border:none;padding:4px 10px;border-radius:6px;font-size:12px;cursor:pointer;font-family:system-ui}",
				".madazi-ai-cursor{position:fixed;width:32px;height:32px;border-radius:50%;border:2px solid #3b82f6;background:rgba(37,99,235,.16);z-index:2147483004;pointer-events:none;display:none;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#3b82f6;font-family:system-ui;box-shadow:0 0 14px rgba(59,130,246,.35);transform:translate(-50%,-50%)}",
			].join("");
			document.head.appendChild(st);
		};
		const ensureOverlay = () => {
			ensureOverlayStyle();
			if (madaziOverlayEl) return;
			madaziOverlayEl = document.createElement("div");
			madaziOverlayEl.className = "madazi-agent-overlay";
			madaziOverlayEl.id = "madazi-agent-overlay";
			document.body.appendChild(madaziOverlayEl);
			const pill = document.createElement("div");
			pill.className = "madazi-agent-pill";
			pill.id = "madazi-agent-pill";
			pill.innerHTML = '<span class="dot"></span><span>Agent 操控中…</span>';
			document.body.appendChild(pill);
			const btn = document.createElement("button");
			btn.className = "madazi-agent-takeover";
			btn.id = "madazi-agent-takeover";
			btn.textContent = "✋ 我来接管";
			btn.addEventListener("click", () => {
				window[BROWSER_TAKEOVER_KEY] = Date.now(); // ★ 存时间戳：120s 过期，活跃续期（见 _onTakeoverActivity）
				const cur = _browserSessionId();
				if (cur) _takenOver.set(cur, Date.now());
				_reportUserTakeover("takeover"); // ★ 上报 server 全局接管
				hideAgentOverlay(cur);
				showTakeoverBadge();
			});
			document.body.appendChild(btn);
			const badge = document.createElement("div");
			badge.className = "madazi-agent-badge";
			badge.id = "madazi-agent-badge";
			badge.innerHTML = '<span>已由你接管</span><button id="madazi-agent-resume">恢复 AI 控制</button>';
			badge.querySelector("#madazi-agent-resume").addEventListener("click", () => {
				window[BROWSER_TAKEOVER_KEY] = false;
				const cur = _browserSessionId();
				if (cur) _takenOver.delete(cur);
				_reportUserTakeover("release"); // ★ 上报 server 释放
				badge.style.display = "none";
			});
			document.body.appendChild(badge); // ★ 2026-09-05 修复：此前误删此行 → badge 从未入 DOM，点「我来接管」后 getElementById 为 null 抛 TypeError，无释放入口
			const cur = document.createElement("div");
			cur.className = "madazi-ai-cursor";
			cur.id = "madazi-ai-cursor";
			cur.textContent = "AI";
			document.body.appendChild(cur);
		};
		// AI 光标跟随鼠标（仅接管期间、鼠标在预览窗口内时可见）
		// ★ 父窗口 mousemove 不跨 iframe → 直接向同源 iframe 文档挂监听（browser/view
		//   壳页同源可访问 contentWindow.document）；坐标 = frame 视口偏移 + iframe 内
		//   clientX/Y；iframe 导航重建/换页后由指令泵每 tick 自动重挂
		const madaziAgentCursor = () => document.getElementById("madazi-ai-cursor");
		let madaziPointerDoc = null;
		const stopPointerTrack = () => {
			if (!madaziPointerDoc) return;
			try { madaziPointerDoc.removeEventListener("mousemove", onPointerMove, true); } catch (e) { /* ignore */ }
			madaziPointerDoc = null;
		};
		// AI 光标移动到预览窗口内坐标（iframe 内坐标系）：action 联动带滑动+按压缩放动画，鼠标跟随为瞬移
		// ★ 坐标钳制：注入脚本报的是元素中心，元素滚出/折叠到 iframe 视口外时坐标为负或超界
		//   （实测侧栏折叠时 x=-120）→ 光标会漂出浏览器面板。钳到可视矩形内（贴最近的边），
		//   视口内的正常坐标原样通过（min/max 对界内值无影响）。
		const moveAgentCursorTo = (ix, iy, animate, frame) => {
			const c = madaziAgentCursor();
			if (!c || !frame) return;
			const r = frame.getBoundingClientRect();
			const bl = frame.clientLeft || 0;
			const bt = frame.clientTop || 0;
			const fw = Math.max(24, r.width - bl * 2);
			const fh = Math.max(24, r.height - bt * 2);
			const cx = Math.min(Math.max(ix, 12), fw - 12);
			const cy = Math.min(Math.max(iy, 12), fh - 12);
			c.style.transition = animate ? "left .28s ease-out, top .28s ease-out" : "none";
			c.style.left = (r.left + bl + cx) + "px";
			c.style.top = (r.top + bt + cy) + "px";
			c.style.display = "flex";
			if (animate) {
				c.style.animation = "madaziAgentClick .5s ease-out";
				window.setTimeout(() => { c.style.transition = "none"; c.style.animation = "none"; }, 520);
			}
		};
		const onPointerMove = (ev) => {
			if (!madaziOverlayEl || madaziOverlayEl.style.display === "none") return;
			const cur = _browserSessionId();
			moveAgentCursorTo(ev.clientX, ev.clientY, false, findBrowserFrameForSession(cur));
		};
		const ensurePointerTrack = (frame) => {
			// ★ 跨域 iframe（如直接导航到 pv-* 域名）访问 contentWindow.document 会抛
			//   SecurityError → 必须 try 包裹，跨域则跳过光标追踪（不阻断指令泵）
			let doc = null;
			try { doc = frame && frame.contentWindow && frame.contentWindow.document; }
			catch (e) { doc = null; }
			if (!doc || doc === madaziPointerDoc) return;
			stopPointerTrack();
			madaziPointerDoc = doc;
			try { doc.addEventListener("mousemove", onPointerMove, true); }
			catch (e) { madaziPointerDoc = null; }
		};
		// 父窗口 mousemove：只做"指针移出预览区域 → 隐藏光标"判定（iframe 内事件到不了父窗口）
		const onAgentMouseMove = (ev) => {
			const c = madaziAgentCursor();
			if (!c || !madaziOverlayEl || madaziOverlayEl.style.display === "none") return;
			const r = madaziOverlayEl.getBoundingClientRect();
			if (ev.clientX < r.left - 4 || ev.clientX > r.right + 4 || ev.clientY < r.top - 4 || ev.clientY > r.bottom + 4) {
				c.style.display = "none";
			}
		};
		if (typeof window !== "undefined") window.addEventListener("mousemove", onAgentMouseMove, true);
		// 覆盖层重定位：跟随 BrowserView iframe 当前矩形（面板拖动/缩放/布局变化/iframe 后出现都跟住）
		const repositionAgentOverlay = () => {
			if (!madaziOverlayEl || madaziOverlayEl.style.display === "none") return;
			const cur = _browserSessionId();
			const frame = findBrowserFrameForSession(cur);
			if (!frame) return;
			const r = frame.getBoundingClientRect();
			madaziOverlayEl.style.top = r.top + "px";
			madaziOverlayEl.style.left = r.left + "px";
			madaziOverlayEl.style.width = r.width + "px";
			madaziOverlayEl.style.height = r.height + "px";
			const pill = document.getElementById("madazi-agent-pill");
			if (pill) {
				pill.style.top = (r.top + 14) + "px";
				pill.style.left = (r.left + r.width / 2) + "px";
				pill.style.transform = "translateX(-50%)";
			}
			const btn = document.getElementById("madazi-agent-takeover");
			if (btn) {
				btn.style.right = Math.max(20, window.innerWidth - r.right + 20) + "px";
				btn.style.bottom = Math.max(20, window.innerHeight - r.bottom + 20) + "px";
			}
		};
		// ★ 多会话：overlay 只对「当前可见会话」显示（后台会话接管不打扰前台）
		const showAgentOverlay = (sid) => {
			ensureOverlay();
			if (sid !== _browserSessionId()) return; // 后台会话：不显示覆盖层
			const frame = findBrowserFrameForSession(sid);
			if (frame) {
				ensurePointerTrack(frame);
				const r = frame.getBoundingClientRect();
				const c = madaziAgentCursor();
				if (c) {
					c.style.display = "flex";
					c.style.left = (r.left + r.width / 2) + "px";
					c.style.top = (r.top + r.height / 2) + "px";
				}
			}
			madaziOverlayEl.style.display = "block";
			madaziOverlayEl.style.pointerEvents = "auto";
			madaziOverlayEl.style.cursor = "auto";
			document.getElementById("madazi-agent-pill").style.display = "flex";
			document.getElementById("madazi-agent-takeover").style.display = "block";
			repositionAgentOverlay();
			if (madaziReposTimer) clearInterval(madaziReposTimer);
			madaziReposTimer = setInterval(repositionAgentOverlay, 500);
		};
		const hideAgentOverlay = (sid) => {
			if (!madaziOverlayEl) return;
			if (sid !== undefined && sid !== null && sid !== _browserSessionId()) return; // 后台会话不动 DOM
			stopPointerTrack();
			if (madaziReposTimer) { clearInterval(madaziReposTimer); madaziReposTimer = null; }
			madaziOverlayEl.style.display = "none";
			madaziOverlayEl.style.pointerEvents = "none";
			document.getElementById("madazi-agent-pill").style.display = "none";
			document.getElementById("madazi-agent-takeover").style.display = "none";
			const c = madaziAgentCursor();
			if (c) c.style.display = "none";
		};
		let _badgeCheckTimer = null;
			// ★ 徽章锚定浏览器面板右下角（与「我来接管」按钮同算法：面板角外 20px、视口钳制）。
			//   接管后 overlay 已隐藏 → repositionAgentOverlay 早退，徽章必须自带定位；
			//   否则落在 CSS 默认的视口右下角（实测漂到面板下方 183px 的终端区）。
			const positionBadgeToFrame = () => {
				const badge = document.getElementById("madazi-agent-badge");
				if (!badge || badge.style.display === "none") return;
				const frame = findBrowserFrameForSession(_browserSessionId());
				if (!frame) return;
				const r = frame.getBoundingClientRect();
				badge.style.right = Math.max(20, window.innerWidth - r.right + 20) + "px";
				badge.style.bottom = Math.max(20, window.innerHeight - r.bottom + 20) + "px";
			};
			const showTakeoverBadge = () => {
				document.getElementById("madazi-agent-badge").style.display = "flex";
				positionBadgeToFrame();
				// ★ 过期自动隐藏：本地接管时间戳超 TTL（用户走开未续期，AI 已自动恢复）
				//   → 徽章与实际状态同步消失，不留「已由你接管」的过期谎言；
				//   期间每 3s 跟随面板重锚（用户接管中拖动面板/改布局不掉队）
				if (_badgeCheckTimer) { clearInterval(_badgeCheckTimer); _badgeCheckTimer = null; }
				_badgeCheckTimer = setInterval(() => {
					const b = document.getElementById("madazi-agent-badge");
					const uat = _userTakeoverAt();
					const expired = !uat || Date.now() - uat >= TAKEOVER_TTL;
					if (!b || b.style.display === "none" || expired) {
						if (b && expired) b.style.display = "none";
						if (_badgeCheckTimer) { clearInterval(_badgeCheckTimer); _badgeCheckTimer = null; }
						return;
					}
					positionBadgeToFrame();
				}, 3000);
			};

		// ★ 2026-09-13 navigate 目标规范化：AI 常传 '/' 等相对路径。相对路径若漏到
		//   _ensureFor（首次导航、浏览器 tab 未建）会被 Workbench 直接 commitBrowserUrl
		//   → iframe 加载 /git/browser/view?u=%2F → normalizeBrowserUrl('/')=null →
		//   BROWSER_BAD_URL「这个地址不是网页」。故 navigate 必须先解析为预览绝对 URL。
		//   base 来源：① 帧 src（browser/view?u=xxx 或直链绝对 URL）② 平台预览状态（previewStatus.url）。
		//   返回 { ok:bool, url?, hint? }：ok=false 时调用方给出可读提示，绝不放行相对路径。
		const resolveNavTarget = async (rawTarget, sid, frame) => {
			const target = String(rawTarget || "").trim();
			if (!target) return { ok: true, url: target }; // 空由调用方报「缺 url」
			if (/^https?:\/\//i.test(target)) return { ok: true, url: target };
			let base = "";
			// 1) 帧 src 提取真实预览地址（u= 参数优先，直链绝对 URL 兜底）
			if (frame) {
				const cur = frame.getAttribute("src") || "";
				const um = cur.match(/[?&]u=([^&]+)/);
				if (um) { try { base = decodeURIComponent(um[1]); } catch { /* ignore */ } }
				if (!base && /^https?:\/\//.test(cur)) base = cur.split(/[?#]/)[0];
			}
			// 2) 帧未建/帧无绝对 base → 平台预览状态兜底（当前项目 previewStatus.url）
			if (!base) {
				try {
					const svc = window.__madaziSvc;
					const pid = (typeof _currentProjectId === "function" && _madaziCtx) ? (_currentProjectId(_madaziCtx) || "") : "";
					if (pid && svc && typeof svc.previewStatus === "function") {
						const d = await svc.previewStatus(pid).catch(() => null);
						const v = d && d.ok ? d.value : d;
						const u = v && v.url;
						if (u && /^https?:\/\//i.test(String(u))) base = String(u);
					}
				} catch (e) { /* ignore */ }
			}
			if (!base) {
				return { ok: false, hint: "无法把相对路径解析为预览绝对地址：请先启动预览（preview_start）或用完整 http(s) 地址（如 http://127.0.0.1:<端口>/）" };
			}
			try {
				const abs = new URL(target.replace(/^\.?\//, ""), base).href;
				return { ok: true, url: abs };
			} catch {
				return { ok: false, hint: "目标地址无法解析为绝对 URL，请用 http:// 或 https:// 开头" };
			}
		};
		// 导航类指令（泵直接控制 iframe，无需注入脚本）
		const handleNavCmd = (cmd, frame) => {
			const w = frame.contentWindow;
			try {
				if (cmd.type === "navigate") {
						let target = String(cmd.url || "").trim();
						if (!target) return { ok: false, error: "navigate 缺 url" };
						// ★ 2026-09-13 AI 常传相对路径（尤其 '/'）→ 解析为当前浏览器视图页的绝对地址：
						//   先把 frame.src（含 /git/browser/view?u=<绝对URL> 或直接预览 URL）里的真实页
						//   取为 base，再 new URL(rel, base)。否则相对导航会落到同源站点根/被地址校验拒。
						if (/^\//.test(target)) {
							const cur = frame.getAttribute("src") || "";
							let base = cur.split("?")[0];
							const um = cur.match(/[?&]u=([^&]+)/);
							if (um) { try { base = decodeURIComponent(um[1]); } catch { /* 保留 fallback */ } }
							const baseUrl = /^https?:\/\//i.test(base)
								? (() => { try { return new URL(base); } catch { return null; } })()
								: null;
							if (baseUrl) {
								try { target = new URL(target.replace(/^\.?\//, ""), baseUrl).href; }
								catch { /* 解析失败走旧拼接 */ }
							}
							if (target[0] === "/") {
								// 兜底：无绝对 base 时的旧规则（基于 src 目录拼接）
								const dir = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : base;
								target = dir + "/" + target.replace(/^\.?\//, "");
							}
						}
					// ★ 分流规则（2026-09-13 回归修正）：
//   · pv-* 子域（k8s）→ 走代理壳页 /git/browser/view?u=...（保留注入脚本 + 同源）
//   · 其他绝对 http(s)（单机 127.0.0.1:<port>）→ 直连 frame.src。单机版不可走壳页：
//     壳页 wrap 后 vite 的 <script src="/@vite/client"> 根绝对路径解析到 dsh 域 404
//     （已实测），页面 JS 崩 → 登录无反应；直连则 vite 资源从自身端口加载，页面完整。
//     直连为跨域 iframe（注入脚本失效 → AI snapshot/click 不可用），但用户手动登录/浏览正常。
if (/^https?:\/\/pv-[0-9a-fA-F]{8}\./i.test(target)) {
	frame.src = "/git/browser/view?u=" + encodeURIComponent(target);
} else {
	// 单机 127.0.0.1:<port> 等：直连（vite 资源从自身端口加载；壳页会让 /@vite/client 落 dsh 域 404）
	frame.src = target;
}
					return { ok: true, url: target };
				}
				if (cmd.type === "reload") { frame.src = frame.getAttribute("src") || ""; return { ok: true }; }
				if (cmd.type === "back") { w.history.back(); return { ok: true }; }
				if (cmd.type === "forward") { w.history.forward(); return { ok: true }; }
			} catch (e) {
				return { ok: false, error: String((e && e.message) || e) };
			}
			return { ok: false, error: "unknown nav cmd " + cmd.type };
		};

		// ── 每会话泵循环 ──
		const runningLoops = new Map(); // sid -> true
		// 最近发起过 prompt 的会话（后台会话触发源）：12-meta-reporting 拦截 session.prompt 时登记
		const recentlyPrompted = new Map(); // sid -> lastAt
		const _registerPrompt = (sid) => { if (sid) recentlyPrompted.set(sid, Date.now()); };
		const PROMPT_IDLE_TTL = 5 * 60 * 1000;
		// 暴露给 12-meta-reporting.js（后台会话起循环的唯一入口）
		try { window.__madaziRegisterBrowserPrompt = _registerPrompt; } catch (e) { /* ignore */ }

		// 会话专属浏览器 URL：优先 navigate 指令自带，否则回退当前工作区预览（仅当前会话可靠）
		const _ensureFor = (sid, url) => {
			try {
				const ensure = window.__madaziBrowserEnsure;
				if (typeof ensure === "function") {
					const cur = _browserSessionId();
					return ensure(sid || undefined, url || undefined, { activate: sid === cur });
				}
			} catch (e) { /* ignore */ }
			return null;
		};

		// 执行一条归属 sid 的指令（原单循环执行体参数化）
			const executeCommandFor = async (cmd, sid) => {
				// 归属双保险：指令声明归属其他会话 → 不执行（host 已定向派发，此处防御竞态）
				if (cmd.sessionId && cmd.sessionId !== sid) {
					postBrowserResultFor(cmd.id, { ok: false, error: "浏览器指令归属其他会话，当前泵不执行（多会话各响应各的窗口）" }, sid);
					return;
				}
				// ★ 2026-09-13 navigate 相对路径统一规范化：AI 常传 '/' 等相对地址。
				//   必须在「找帧/_ensureFor 开 tab」之前解析——否则首次导航（tab 未建）
				//   原样提交 '/':commitBrowserUrl → iframe /git/browser/view?u=%2F →
				//   normalizeBrowserUrl('/')=null → BROWSER_BAD_URL「这个地址不是网页」。
				if (cmd.type === "navigate") {
					const rawUrl = String(cmd.url || "");
					const resolved = await resolveNavTarget(rawUrl, sid, findBrowserFrameForSession(sid));
					if (!resolved.ok) {
						postBrowserResultFor(cmd.id, { ok: false, error: resolved.hint }, sid);
						return;
					}
					cmd = { ...cmd, url: resolved.url };
				}
				// 预览启停不涉及浏览器操控，不受接管门控，最先处理
				if (cmd.type === "preview_start" || cmd.type === "preview_stop") {
					const svc = window.__madaziSvc || null;
					const pid = String(cmd.pid || "");
					if (!svc || !pid) {
						postBrowserResultFor(cmd.id, { ok: false, error: !svc ? "平台服务桥接不可用（__madaziSvc 未注入）" : "缺少项目 ID" }, sid);
				} else {
					const fn = cmd.type === "preview_start" ? svc.previewStart : svc.previewStop;
					try {
						Promise.resolve(fn(pid)).then(async (d) => {
							const v = d && d.ok ? d.value : d;
							if (cmd.type === "preview_start") {
								const isReady = (x) => !!(x && (x.running === true || x.status === "running" || x.status === "ready"));
								if (isReady(v)) return postBrowserResultFor(cmd.id, { ok: true, data: v, raw: d, note: "预览已就绪" }, sid);
								for (let i = 0; i < 36; i++) {
									await new Promise((r) => setTimeout(r, 5000));
									const s = await svc.previewStatus(pid).catch(() => null);
									const sv = s && s.ok ? s.value : s;
									if (isReady(sv)) return postBrowserResultFor(cmd.id, { ok: true, data: sv, raw: s, note: "预览已就绪" }, sid);
								}
								return postBrowserResultFor(cmd.id, { ok: false, error: "等待预览就绪超时（180s），请查看预览日志排查" }, sid);
							}
							return postBrowserResultFor(cmd.id, { ok: !!(d && d.ok), data: v, raw: d }, sid);
						}).catch((e) => postBrowserResultFor(cmd.id, { ok: false, error: String((e && e.message) || e) }, sid));
					} catch (e) {
						postBrowserResultFor(cmd.id, { ok: false, error: String((e && e.message) || e) }, sid);
					}
				}
				return;
			}
			// takeover 指令优先处理（不被用户接管锁拦截）：AI 可发 takeover(stop) 主动结束接管
			//   ——否则用户点过「我来接管」后 AI 连解锁指令都被拦（死锁）。
			if (cmd.type === "takeover") {
				if (cmd.action === "start") _takenOver.set(sid, Date.now());
				else _takenOver.delete(sid);
				if (cmd.action === "start") showAgentOverlay(sid);
				else hideAgentOverlay(sid);
				postBrowserResultFor(cmd.id, { ok: true, takenOver: cmd.action === "start", note: cmd.action === "start" ? "已开始 AI 接管" : "已结束 AI 接管" }, sid);
				return;
			}
			// ★ 2026-09-04 用户接管不再在客户端拦截：拦截已上移到 server runCommand 入口
			//   （按会话全局，任何窗口一致）。客户端 _isTakenOver 是 per-window 内存，多窗口
			//   竞争时「带锁窗口」会误拦（UI 与报错矛盾）——故此处删除拦截分支，交给 server。
			// 普通浏览器操控指令
			let frame = findBrowserFrameForSession(sid);
			if (!frame || !frame.contentWindow) {
				// ★ AI 自动打开内置浏览器：无 iframe → 调 workbench 钩子按会话开 tab
				//   （后台会话 activate:false 建隐藏 tab，不抢当前视图），轮询等 iframe 出现
				_ensureFor(sid, cmd.type === "navigate" ? String(cmd.url || "") : undefined);
				let waited = 0;
				while (waited < 20000) {
					await new Promise((r) => setTimeout(r, 200));
					waited += 200;
					frame = findBrowserFrameForSession(sid);
					if (frame && frame.contentWindow) break;
					if (waited === 5000 || waited === 10000) {
						_ensureFor(sid, cmd.type === "navigate" ? String(cmd.url || "") : undefined);
					}
				}
			}
			if (!frame || !frame.contentWindow) {
				postBrowserResultFor(cmd.id, { ok: false, error: "浏览器未打开或无页面（已尝试自动打开；预览回填/加载中请稍后重试，若仍失败请确认预览已启动）" }, sid);
				return;
			}
			if (cmd.type === "navigate" || cmd.type === "reload" || cmd.type === "back" || cmd.type === "forward") {
				const navResult = handleNavCmd(cmd, frame);
				postBrowserResultFor(cmd.id, navResult, sid);
				return;
			}
			if (isInjectedReady(frame)) {
				const result = await new Promise((resolve) => {
					let done = false;
					const onMsg = (ev) => {
						const m = ev.data;
						if (!m || m.source !== BROWSER_AGENT_SOURCE || m.id !== cmd.id) return;
						if (m.type === "agent-result" || m.type === "eval-result") {
							done = true;
							window.removeEventListener("message", onMsg);
							// AI 操作光标联动：click/type 结果带元素中心坐标 → 光标滑过去（像真人操作）
							const d = m && m.data;
							if (d && (d.type === "click" || d.type === "type") && typeof d.x === "number" && typeof d.y === "number") {
								moveAgentCursorTo(d.x, d.y, true, frame);
							}
							resolve(m);
						}
					};
					window.addEventListener("message", onMsg);
					const t = setTimeout(() => {
						if (!done) {
							window.removeEventListener("message", onMsg);
							resolve({ id: cmd.id, ok: false, error: "指令执行超时（20s）" });
						}
					}, 20000);
					try {
						frame.contentWindow.postMessage({ source: BROWSER_AGENT_SOURCE, ...cmd }, "*");
					} catch (e) {
						clearTimeout(t);
						window.removeEventListener("message", onMsg);
						resolve({ id: cmd.id, ok: false, error: String((e && e.message) || e) });
					}
				});
				postBrowserResultFor(cmd.id, result, sid);
				return;
			}
			// 注入脚本未就绪 → 秒级失败（不 return 之外注意：这里直接 return，循环由 loop 外层驱动）
			postBrowserResultFor(cmd.id, { ok: false, error: "浏览器页面加载中（页面脚本未就绪），请稍后重试，可先 browser_wait 1-3 秒等待页面加载完成" }, sid);
		};

		// 单会话长轮询循环
		const loopFor = (sid) => {
			if (!sid || runningLoops.has(sid)) return;
			runningLoops.set(sid, true);
			const token = _browserTabIdFor(sid);
			const loop = async () => {
				try {
					const r = await fetch("/git/browser-command?session=" + encodeURIComponent(sid) + "&tab=" + encodeURIComponent(token) + "&user=" + encodeURIComponent(_myUid || ""), { signal: AbortSignal.timeout(30000) });
					// ★ 401（已登出/鉴权失效）自停该会话循环：长轮询秒回 401 + 100ms 重试 = 请求风暴
					if (r.status === 401) { runningLoops.delete(sid); return; }
					const cmd = await r.json().catch(() => ({}));
					if (cmd && cmd.id) await executeCommandFor(cmd, sid);
				} catch (e) { /* 网络/超时，继续拉 */ }
				// 接管期间光标追踪常驻：iframe 导航重建/换页（文档替换）后自动重挂监听
				try {
					if (madaziOverlayEl && madaziOverlayEl.style.display === "block") ensurePointerTrack(findBrowserFrameForSession(sid));
					// ★ 活跃续期监听：无条件挂（用户接管期间 overlay 隐藏，不能只靠 overlay 显示时挂）
					_ensureTakeoverActivityTrack(findBrowserFrameForSession(sid));
				} catch (e) { /* 跨域/异常不阻断泵 */ }
				if (runningLoops.has(sid)) setTimeout(loop, 100);
			};
			setTimeout(loop, 0);
		};
		const stopLoop = (sid) => { runningLoops.delete(sid); };

		// ── 窗口获焦上报：谁发消息谁控制（同用户多窗口不漂移）──
		// 打字/点快捷选择的前提是窗口有焦点 → 焦点窗口 = 消息发起窗口。
		// focus 事件即时上报当前会话；reconcile 周期兜底（会话切换时窗口可能
		// 一直有焦点无新 focus 事件；_myUid 延迟加载后也要补报）。
		let _lastFocusSid = "";
		const _reportFocus = () => {
			try {
				if (!document.hasFocus() || !_myUid) return;
				// ★ 已登出不再上报（/git/browser-focus 同为认证端点，登出后 401 刷屏）
				if (window.__madaziLoggedIn === false) return;
				const sid = _browserSessionId();
				if (!sid) return;
				fetch("/git/browser-focus", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ sessionId: sid, tab: _browserTabIdFor(sid), userId: _myUid }),
				}).then(() => { _lastFocusSid = sid; }).catch(() => {});
			} catch (e) { /* ignore */ }
		};
		window.addEventListener("focus", _reportFocus);

		// ── 循环启停 reconcile（2s）：当前会话 + 最近 prompt 会话 + 已绑定 tab 的会话 ──
		const reconcileLoops = () => {
			// ★ 已登出（login 插件置 __madaziLoggedIn=false）：停全部循环且不再拉起新循环。
			//   否则每 2s reconcile 重启 loop → 长轮询秒回 401 → 100ms 重试风暴；
			//   重新登录标志恢复 true 后此处自动放行、循环重启
			if (window.__madaziLoggedIn === false) {
				for (const sid of runningLoops.keys()) stopLoop(sid);
				return;
			}
			const now = Date.now();
			// 焦点兜底补报：会话已切换/uid 刚加载，窗口持续有焦点也要把当前会话报上去
			try {
				if (_myUid && document.hasFocus()) {
					const c = _browserSessionId();
					if (c && c !== _lastFocusSid) _reportFocus();
				}
			} catch (e) { /* ignore */ }
			const targets = new Set();
			const cur = _browserSessionId();
			if (cur) targets.add(cur);
			for (const [sid, at] of recentlyPrompted) {
				if (now - at > PROMPT_IDLE_TTL) { recentlyPrompted.delete(sid); continue; }
				targets.add(sid);
			}
			try {
				const m = window.__madaziBrowserBySession;
				if (m && typeof m.size === "number" && m.size > 0) for (const sid of m.keys()) targets.add(sid);
			} catch (e) { /* ignore */ }
			for (const sid of targets) loopFor(sid);
			for (const sid of runningLoops.keys()) {
				if (!targets.has(sid)) stopLoop(sid);
			}
		};
		// 页面就绪后启动：先跑一轮 reconcile（当前会话即刻起循环），再 2s 周期 reconcile
		if (typeof document !== "undefined") {
			const _boot = () => {
				setTimeout(() => { reconcileLoops(); setInterval(reconcileLoops, 2000); }, 1500);
			};
			if (document.readyState === "complete" || document.readyState === "interactive") _boot();
			else document.addEventListener("DOMContentLoaded", _boot, { once: true });
		}

// ═══════════════════════════════════════════════════════════════
// src/23-cross-project-ref.js
// ═══════════════════════════════════════════════════════════════
	// ── @ 跨项目文件引用（第二个 @ 源：官方源之外的兜底扩展） ──────────────────────────
	// 官方 @ 源（ui-reference）只搜当前会话 cwd（当前项目）；本源补跨项目：
	// GET /api/projects/search-files（cookie 认证，服务端按成员权限过滤，见 projects.js）。
	// 候选按项目名分 section（以项目区分开）；mention 用绝对路径 /app/generated/<pid>/…
	// （与 dsh 容器同 PVC 同路径，agent 的 read 工具可直接读）。
	// 目录候选 drill 可逐级下钻：query 变为绝对路径前缀，服务端直列该目录子项。
	// 多源共存依据：inputTriggers 的 (trigger, name) 唯一即可，roster 按 order 排序——
	// 官方 reference 源 order 0 在前，本源 order 5 在后（当前项目结果优先，跨项目补充）。
	const installCrossProjectRef = (ctx) => {
		if (window.__madaziCrossRefInstalled) return;
		const svc = (ctx.inputTriggers && typeof ctx.inputTriggers.registerSource === "function")
			? ctx.inputTriggers
			: (typeof ctx.get === "function" ? ctx.get("inputTriggers") : null);
		if (!svc || typeof svc.registerSource !== "function") { console.warn("[madazi] inputTriggers 不可用，跨项目 @ 未注册"); return; }

		// mention 文法（与官方 formatFileMention 同语义）：目录尾斜杠保持 token 开启（下钻续打）
		const _xrefMention = (absPath, isDir) => {
			const p = isDir ? absPath + "/" : absPath;
			if (/[\u0000-\u001f\u007f-\u009f"]/u.test(p)) return null;
			const q = /\s/u.test(p);
			if (isDir) return q ? "@\"" + p : "@" + p;
			return q ? "@\"" + p + "\"" : "@" + p;
		};

		const source = {
			trigger: "@",
			name: "madazi-cross-project",
			order: 5,
			showGroupTitle: false,
			candidates: async (session, req) => {
				const q = String((req && req.query) || "");
				try {
					// 排除当前项目（官方 @ 源已覆盖 cwd 内文件，避免两源重复列出）
					let exclude = "";
					try {
						const pid = _pidOfSession(ctx, session && session.sessionId);
						if (pid) exclude = "&exclude=" + encodeURIComponent(pid);
					} catch (e) { /* ignore */ }
					const d = await madaziFetch("/projects/search-files?q=" + encodeURIComponent(q) + "&limit=12" + exclude, {
						signal: (req && req.signal) || undefined,
					});
					if (!d || d.error || !Array.isArray(d.items)) return [];
					const out = [];
					for (const it of d.items) {
						if (!it || !it.absPath) continue;
						const isProj = it.kind === "project";
						const isDir = isProj || it.kind === "directory";
						const mention = _xrefMention(String(it.absPath), isDir);
						if (!mention) continue;
						const label = isProj ? String(it.projectName || "项目") : String(it.absPath.slice(it.absPath.lastIndexOf("/") + 1));
						const slash = it.relPath ? String(it.relPath).lastIndexOf("/") : -1;
						const parent = slash > 0 ? String(it.relPath).slice(0, slash) : "";
						out.push({
							name: label + (isDir ? "/" : ""),
							description: isProj ? "跨项目文件" : (parent || "（项目根）"),
							icon: isDir ? "folder" : "file",
							section: isProj ? "项目" : String(it.projectName || "项目"),
							value: JSON.stringify({ kind: "file", fileKind: isDir ? "directory" : "file", label, mention }),
							...(isDir ? { drill: true } : {}),
						});
					}
					return out;
				} catch (e) { return []; }
			},
			onPick: ({ candidate, action }) => {
				try {
					const v = JSON.parse(candidate.value);
					if (v.fileKind === "directory" && action === "drill") return { text: v.mention, continue: true };
					return { insert: {
						source: "madazi-cross-project",
						ref: v.mention,
						label: v.fileKind === "directory" ? v.label + "/" : v.label,
						appearance: v.fileKind === "directory" ? "folder" : "file",
						clipboardText: v.mention,
					} };
				} catch (e) { return undefined; }
			},
			// 发送时芯片序列化：mention 原文即模型形态（绝对路径 @ 引用，agent read 可读）
			codec: {
				clipboardText: (ref) => ref,
				serialize: (ref) => Promise.resolve(ref),
			},
		};
		try {
			svc.registerSource(source);
			window.__madaziCrossRefInstalled = true;
		} catch (e) { console.warn("[madazi] 跨项目 @ 注册失败:", e); }
	};
		module.exports.inject = ["slots", "locale", "sessions", "workspaces", "remote", "inputTriggers"];
		return module.exports;
	}
});
