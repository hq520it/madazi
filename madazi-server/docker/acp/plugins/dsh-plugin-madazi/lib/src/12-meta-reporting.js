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
