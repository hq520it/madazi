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
