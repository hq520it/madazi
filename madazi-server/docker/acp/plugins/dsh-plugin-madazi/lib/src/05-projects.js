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
