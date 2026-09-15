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
