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
