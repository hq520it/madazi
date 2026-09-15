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
