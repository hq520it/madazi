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
