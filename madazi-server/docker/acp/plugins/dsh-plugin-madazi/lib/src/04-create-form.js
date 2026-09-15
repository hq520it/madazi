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

