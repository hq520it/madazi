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
