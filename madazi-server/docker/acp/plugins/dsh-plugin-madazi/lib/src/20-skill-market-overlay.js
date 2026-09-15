	// ── 技能市场浮层（/ 面板头部固定入口 + /技能市场 兜底）──────────────────
	// 零官方 patch：面板头部入口用 DOM 注入（MutationObserver 定位 role=listbox，
	// 插入固定 header，React 重渲染移走则重插）；点开全屏浮层复用市场 API
	// （GET /skills 列表 / GET /skills/:id 详情 / POST .../install/:projectId 安装 /
	// POST /skills 发布）。安装默认当前项目（_currentProjectId）。
	// 数据接口与 18-skills.js 的 SkillMarketBrowser 同源（浏览器同域 cookie 鉴权）。

	const openSkillMarketOverlay = () => {
		if (document.querySelector(".madazi-mkt-overlay")) return;
		const ov = document.createElement("div");
		ov.className = "madazi-mkt-overlay";
		ov.innerHTML =
			'<div class="madazi-mkt-dialog">' +
				'<div class="madazi-mkt-hd"><span class="madazi-mkt-title">技能市场</span>' +
					'<button type="button" class="madazi-members-close" data-mkt-close="1" title="关闭">✕</button></div>' +
				'<div class="madazi-mkt-body" data-mkt-body="1"><div class="madazi-members-load">加载技能市场…</div></div>' +
				'<div class="madazi-mkt-msg" data-mkt-msg="1"></div>' +
			"</div>";
		document.body.appendChild(ov);
		const bodyEl = ov.querySelector("[data-mkt-body]");
		const msgEl = ov.querySelector("[data-mkt-msg]");
		const close = () => ov.remove();
		ov.querySelector("[data-mkt-close]").addEventListener("click", close);
		ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
		const say = (type, text) => { msgEl.textContent = text; msgEl.style.color = type === "ok" ? "var(--dsw-alias-state-success-primary,#34C759)" : "var(--dsw-alias-state-error-primary,#FF453A)"; };

		const curProject = () => (typeof _currentProjectId === "function" && _madaziCtx) ? (_currentProjectId(_madaziCtx) || "") : "";
		const sapi = (path, opts) => madaziFetch(path, opts).then((d) => { if (d && d.error) throw new Error(typeof d.error === "object" ? JSON.stringify(d.error) : d.error); return d; });

		const S = { view: "list", list: null, err: null, q: "", category: "", detail: null, projects: null, instProj: curProject(), instBusy: false, pubOpen: false, pub: { name: "", slug: "", description: "", icon: "sparkles", color: "#5E6AD2", category: "general", prompt: "", is_builtin: false }, pubBusy: false, isAdmin: false };

		const loadList = () => {
			say("", ""); S.err = null;
			sapi("/skills").then((v) => {
				const arr = Array.isArray(v) ? v : [];
				const kw = S.q.trim().toLowerCase(), cat = S.category;
				S.list = arr.filter((s) => (!cat || (s.category || "") === cat) && (!kw || ((s.name || "") + " " + (s.description || "")).toLowerCase().indexOf(kw) !== -1));
				render();
			}).catch((e) => { S.err = String((e && e.message) || e); render(); });
		};
		const loadProjects = () => {
			if (S.projects !== null) return;
			sapi("/projects").then((v) => { S.projects = Array.isArray(v) ? v : []; render(); }).catch(() => { S.projects = []; render(); });
		};
		const openDetail = (id) => {
			S.view = "detail"; S.detail = null; S.instProj = curProject(); say("", "");
			loadProjects();
			sapi("/skills/" + id).then((v) => { S.detail = v; render(); }).catch((e) => { say("err", "加载详情失败: " + ((e && e.message) || e)); });
			render();
		};
		const doInstall = () => {
			if (!S.instProj || S.instBusy || !S.detail) return;
			S.instBusy = true; say("", ""); render();
			sapi("/skills/" + S.detail.id + "/install/" + S.instProj, { method: "POST" }).then((v) => {
				if (v && v.ok === false) say("err", "安装失败: " + (v.error || ""));
				else { say("ok", "已安装「" + (S.detail.name || "") + "」到当前项目——对话中输入 /" + (S.detail.slug || S.detail.name || "") + " 可触发"); loadList(); }
			}).catch((e) => say("err", "安装失败: " + ((e && e.message) || e))).finally(() => { S.instBusy = false; render(); });
		};
		const doPublish = () => {
			if (S.pubBusy || !S.pub.name.trim() || !S.pub.prompt.trim()) { if (!S.pub.name.trim() || !S.pub.prompt.trim()) say("err", "名称和技能内容不能为空"); return; }
			S.pubBusy = true; say("", "");
			sapi("/skills", { method: "POST", body: JSON.stringify(S.pub) }).then((v) => {
				if (v && v.error) say("err", "发布失败: " + v.error);
				else { say("ok", "已发布「" + v.name + "」" + (v.is_builtin ? "（官方内置，全项目可用）" : "，可在市场安装")); S.pubOpen = false; S.pub = { name: "", slug: "", description: "", icon: "sparkles", color: "#5E6AD2", category: "general", prompt: "", is_builtin: false }; loadList(); }
			}).catch((e) => say("err", "发布失败: " + ((e && e.message) || e))).finally(() => { S.pubBusy = false; render(); });
		};

		const btn = (label, cls, onClick, disabled) => { const b = document.createElement("button"); b.type = "button"; b.className = cls || "madazi-pop-btn"; b.textContent = label; if (disabled) b.disabled = true; b.addEventListener("click", onClick); return b; };
		const cardRow = (s) => {
			const c = document.createElement("button");
			c.type = "button"; c.className = "madazi-mkt-card";
			c.innerHTML =
				'<div class="madazi-mkt-card-hd">' +
					'<span class="madazi-mkt-icon" style="' + (s.color ? "background:" + s.color + "22;color:" + s.color : "") + '">' + _escHtml((s.name || "?").slice(0, 2)) + "</span>" +
					'<span class="madazi-mkt-name">' + _escHtml(s.name || s.id) + "</span>" +
					(s.is_builtin ? '<span class="madazi-mkt-badge builtin">内置</span>' : "") +
					'<span class="madazi-mkt-badge official">' + _escHtml(s.category || "general") + "</span>" +
				"</div>" +
				(s.description ? '<div class="madazi-mkt-desc">' + _escHtml(s.description) + "</div>" : "") +
				'<div class="madazi-mkt-meta"><span>↓ ' + (s.install_count || 0) + "</span><span>作者 " + _escHtml(s.author_name || "?") + "</span></div>";
			c.addEventListener("click", () => openDetail(s.id));
			return c;
		};

		const render = () => {
			bodyEl.innerHTML = "";
			if (S.view === "detail" && S.detail) {
				const d = S.detail;
				const wrap = document.createElement("div");
				wrap.style.cssText = "display:flex;flex-direction:column;gap:10px";
				wrap.innerHTML =
					'<div style="display:flex;justify-content:space-between;align-items:center"><div class="madazi-settings-title">技能详情</div></div>' +
					'<div class="madazi-settings-row"><div class="madazi-settings-row-main">' +
						'<div class="madazi-settings-row-n">' + _escHtml(d.name || d.id) + "</div>" +
						'<div class="madazi-settings-row-d">' + _escHtml((d.description || "无描述") + " · 作者 " + (d.author_name || "?") + " · 安装 " + (d.install_count || 0)) + "</div></div></div>" +
					(d.prompt ? '<div class="madazi-mkt-readme" style="max-height:240px;overflow-y:auto">' + _escHtml(d.prompt) + "</div>" : "");
				const backBtn = btn("返回市场", "madazi-btn-ghost", () => { S.view = "list"; render(); });
				wrap.querySelector("div").prepend(backBtn);
				if (d.is_builtin) {
					const tip = document.createElement("div");
					tip.className = "madazi-mkt-builtin-tip";
					tip.innerHTML = "<div>内置技能：已在所有项目全局生效，无需安装</div><div style='font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:4px'>在任意项目对话中输入 /" + _escHtml(d.slug || "") + " 即可触发</div>";
					wrap.appendChild(tip);
				} else {
					const row = document.createElement("div");
					row.innerHTML = '<div class="madazi-settings-row-n">安装到项目（默认当前项目）</div><div class="madazi-mkt-install-row"></div>';
					const sel = document.createElement("select");
					sel.className = "madazi-sel"; sel.style.flex = "1";
					const opts = (S.projects || []).map((p) => ({ id: p.id, name: p.name || p.id.slice(0, 8) }));
					const cur = curProject();
					if (!opts.some((o) => o.id === cur)) { opts.unshift({ id: "", name: "选择项目…" }); }
					opts.forEach((o) => { const opt = document.createElement("option"); opt.value = o.id; opt.textContent = o.name; if (o.id === S.instProj) opt.selected = true; sel.appendChild(opt); });
					sel.addEventListener("change", () => { S.instProj = sel.value; });
					row.querySelector(".madazi-mkt-install-row").appendChild(sel);
					row.querySelector(".madazi-mkt-install-row").appendChild(btn(S.instBusy ? "安装中…" : "安装", "madazi-pop-btn primary", doInstall, S.instBusy || !S.instProj));
					wrap.appendChild(row);
				}
				bodyEl.appendChild(wrap);
				return;
			}
			if (S.view === "detail") { bodyEl.innerHTML = '<div class="madazi-members-load">加载详情…</div>'; return; }
			if (S.pubOpen) {
				const wrap = document.createElement("div");
				wrap.style.cssText = "display:flex;flex-direction:column;gap:8px";
				const f = (label, key, placeholder, textarea) => {
					const box = document.createElement("div");
					box.style.cssText = "display:flex;flex-direction:column;gap:4px";
					box.innerHTML = '<label style="font-size:11px;color:var(--dsw-alias-label-secondary)">' + _escHtml(label) + "</label>";
					const inp = textarea ? document.createElement("textarea") : document.createElement("input");
					inp.className = "madazi-inp";
					if (textarea) { inp.rows = 8; inp.style.cssText = "font-family:ui-monospace,Menlo,monospace;font-size:12px"; }
					inp.placeholder = placeholder || ""; inp.value = S.pub[key] || "";
					inp.addEventListener("input", () => { S.pub[key] = inp.value; });
					box.appendChild(inp);
					return box;
				};
				wrap.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center"><div class="madazi-settings-title">发布技能</div></div>';
				[["名称 *", "name", "如：代码审查助手"], ["英文标识（/xxx 触发，kebab-case；可留空）", "slug", "如：code-review"], ["描述", "description", "一句话说明用途"]].forEach(([l, k, p]) => wrap.appendChild(f(l, k, p)));
				if (S.isAdmin) {
					const b = document.createElement("div");
					b.style.cssText = "display:flex;align-items:center;gap:8px";
					b.innerHTML = '<label style="font-size:12px;color:var(--dsw-alias-label-secondary)">发布为官方内置（所有项目自动可用）</label>';
					const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!S.pub.is_builtin;
					cb.addEventListener("change", () => { S.pub.is_builtin = cb.checked; });
					b.prepend(cb);
					wrap.appendChild(b);
				}
				wrap.appendChild(f("技能内容 *（markdown，发给 AI 的指令）", "prompt", "## 角色\n…", true));
				const acts = document.createElement("div");
				acts.className = "madazi-mkt-acts";
				acts.appendChild(btn(S.pubBusy ? "发布中…" : "发布", "madazi-pop-btn primary", doPublish, S.pubBusy));
				acts.appendChild(btn("取消", "madazi-pop-btn", () => { S.pubOpen = false; render(); }));
				wrap.appendChild(acts);
				bodyEl.appendChild(wrap);
				return;
			}
			// ── 列表视图 ──
			const cats = [];
			for (const s of S.list || []) if (s.category && cats.indexOf(s.category) === -1) cats.push(s.category);
			const toolbar = document.createElement("div");
			toolbar.className = "madazi-mkt-toolbar";
			const search = document.createElement("input");
			search.className = "madazi-inp"; search.placeholder = "搜索技能名称/描述…"; search.style.cssText = "flex:1;min-width:140px"; search.value = S.q;
			search.addEventListener("keydown", (e) => { if (e.key === "Enter") { S.q = search.value; loadList(); } });
			toolbar.appendChild(search);
			toolbar.appendChild(btn("搜索", "madazi-btn-ghost", () => { S.q = search.value; loadList(); }));
			toolbar.appendChild(btn("发布技能", "madazi-btn-ghost", () => { S.pubOpen = true; render(); }));
			const chips = document.createElement("div");
			chips.className = "madazi-mkt-chips";
			const mkChip = (label, val) => {
				const c = document.createElement("button");
				c.type = "button"; c.className = "madazi-mkt-chip" + (S.category === val ? " on" : ""); c.textContent = label;
				c.addEventListener("click", () => { S.category = val; loadList(); });
				return c;
			};
			chips.appendChild(mkChip("全部", ""));
			cats.forEach((c) => chips.appendChild(mkChip(c, c)));
			const list = document.createElement("div");
			list.className = "madazi-mkt-list";
			if (S.err) list.innerHTML = '<div style="padding:12px;font-size:12px;color:var(--dsw-alias-state-error-primary,#FF453A)">' + _escHtml(S.err) + "</div>";
			else if (S.list === null) list.innerHTML = '<div class="madazi-pop-d">加载中…</div>';
			else if (S.list.length === 0) list.innerHTML = '<div class="madazi-pop-d">暂无技能</div>';
			else S.list.forEach((s) => list.appendChild(cardRow(s)));
			bodyEl.appendChild(toolbar);
			bodyEl.appendChild(chips);
			bodyEl.appendChild(list);
		};

		// 管理员判定（发布表单的"官方内置"开关）
		madaziFetch("/auth/me").then((d) => { const me = d && (d.user || d); S.isAdmin = !!(me && (me.role === "admin" || me.isAdmin)); }).catch(() => {});
		loadList();
		render();
	};

	// / 面板头部固定入口：DOM 注入 role=listbox 顶部（React 重渲染移走则重插）
	// ★ 定位必须精确：页面存在多个 [role=listbox]（如设置面板「提示音」下拉），
	//   只认 / 命令面板（dsh-client-ui-input-trigger MenuView）的 listbox——
	//   特征：class 含 "menu"（MenuView module hash 保留语义名）且非 SoundSettings（提示音）。
	const _findSlashListbox = () => {
		const boxes = Array.from(document.querySelectorAll('[role="listbox"]'));
		for (const b of boxes) {
			const cls = String(b.className || "");
			if (cls.indexOf("menu") === -1) continue;
			const label = String(b.getAttribute("aria-label") || "").toLowerCase();
			if (!label) return b; // MenuView listbox 的 aria-label 由 locale 决定，空时直接认
			if (label.indexOf("sound") !== -1) continue; // SoundSettings 提示音
			if (label.indexOf("提示音") !== -1) continue;
			return b;
		}
		return null;
	};
	const ensureMarketHeader = () => {
		const menu = _findSlashListbox();
		if (!menu || menu.querySelector(".madazi-slash-hd")) return;
		const hd = document.createElement("div");
		hd.className = "madazi-slash-hd";
		hd.innerHTML = '<button type="button" class="madazi-slash-mkt-btn" data-mkt-open="1">技能市场</button><span class="madazi-slash-mkt-hint">浏览/安装到当前项目</span>';
		menu.prepend(hd);
		hd.querySelector("[data-mkt-open]").addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openSkillMarketOverlay(); });
	};
	const installMarketHeaderWatch = () => {
		if (window.__madaziMarketHdInstalled) return;
		window.__madaziMarketHdInstalled = true;
		ensureMarketHeader();
		const mo = new MutationObserver(() => ensureMarketHeader());
		mo.observe(document.body, { childList: true, subtree: true });
	};

	// 兜底入口：/技能市场 斜杠源（order 1，位于官方技能分组之上，纯官方扩展点）
	const installMarketSlash = (ctx) => {
		if (window.__madaziMarketSlashInstalled) return;
		const svc = (ctx.inputTriggers && typeof ctx.inputTriggers.registerSource === "function") ? ctx.inputTriggers : null;
		if (!svc) return;
		try {
			svc.registerSource({
				trigger: "/", name: "madazi-skill-market", order: 1,
				candidates: async (_s, req) => {
					const q = String((req && req.query) || "").trim();
					if (q === "" || "技能市场".indexOf(q) !== -1) return [{ name: "技能市场", description: "打开技能市场（浏览/安装到当前项目）" }];
					return [];
				},
				onPick: () => { openSkillMarketOverlay(); return undefined; },
			});
			window.__madaziMarketSlashInstalled = true;
		} catch (e) { console.warn("[madazi] 技能市场 slash 注册失败:", e); }
	};
