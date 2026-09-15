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
