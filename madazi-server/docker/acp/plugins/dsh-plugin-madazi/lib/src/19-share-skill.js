	// ── 分享技能到市场（对话里 /分享技能） ──────────────────────────
	// 三级体系的人工确认链路：AI 在对话里用 skill-creator 沉淀出项目私有技能
	// （.agents/skills/*.md）→ 用户 /分享技能 → 浮层列表 → 确认后写 skills 表（市场），
	// 其他用户即可安装到自己的项目。安全：模型写出的内容先留在项目沙箱，人工确认才公开。
	// 数据：GET  /api/skills/project/:projectId   项目私有技能列表
	//       POST /api/skills/project/:projectId/:fileName/share   分享到市场
	const _escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

	const openShareSkillOverlay = (projectId) => {
		if (document.querySelector(".madazi-share-overlay")) return;
		const ov = document.createElement("div");
		ov.className = "madazi-share-overlay";
		ov.innerHTML =
			'<div class="madazi-share-dialog">' +
				'<div class="madazi-share-hd"><span class="madazi-share-title">分享技能到市场</span>' +
					'<button type="button" class="madazi-members-close" data-share-close="1" title="关闭">✕</button></div>' +
				'<div class="madazi-share-body" data-share-body="1"><div class="madazi-members-load">加载项目技能…</div></div>' +
				'<div class="madazi-share-foot" data-share-msg="1"></div>' +
			"</div>";
		document.body.appendChild(ov);
		const close = () => ov.remove();
		ov.querySelector("[data-share-close]").addEventListener("click", close);
		ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
		const bodyEl = ov.querySelector("[data-share-body]");
		const msgEl = ov.querySelector("[data-share-msg]");
		const say = (type, text) => { msgEl.textContent = text; msgEl.style.color = type === "ok" ? "var(--dsw-alias-state-success-primary,#34C759)" : "var(--dsw-alias-state-error-primary,#FF453A)"; };
		madaziFetch("/skills/project/" + projectId).then((skills) => {
			const arr = Array.isArray(skills) ? skills : [];
			if (!arr.length) {
				bodyEl.innerHTML = '<div class="madazi-members-load">当前项目还没有技能。在对话里对 AI 说「用 skill-creator 帮我沉淀一个 XX 技能」即可生成项目技能。</div>';
				return;
			}
			bodyEl.innerHTML = "";
			arr.forEach((s) => {
				const fileName = (s.fileName || s.id.replace(/^custom-/, "") + ".md").replace(/\.md$/, "");
				const row = document.createElement("div");
				row.className = "madazi-share-row";
				row.innerHTML =
					'<div class="madazi-share-row-main">' +
						'<div class="madazi-settings-row-n">' + _escHtml(s.name) + ' <span style="font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary)">' + _escHtml(fileName) + "</span></div>" +
						'<div class="madazi-settings-row-d">' + _escHtml(s.description || "无描述") + "</div>" +
					"</div>" +
					'<div class="madazi-share-acts" style="justify-content:flex-start">' +
						'<button type="button" class="madazi-btn-ghost" data-share-btn="1">分享到市场</button>' +
					"</div>" +
					'<div class="madazi-share-form" data-share-form="1" hidden>' +
						'<input class="madazi-inp" data-f="name" placeholder="市场展示名（可填中文）" value="' + _escHtml(s.name) + '">' +
						'<input class="madazi-inp" data-f="desc" placeholder="一句话描述" value="' + _escHtml(s.description || "") + '">' +
						'<input class="madazi-inp" data-f="cat" placeholder="分类（如 code-review / testing）" value="' + _escHtml(s.category || "general") + '">' +
						'<div class="madazi-share-acts">' +
							'<button type="button" class="madazi-pop-btn primary" data-confirm="1">确认分享</button>' +
							'<button type="button" class="madazi-pop-btn" data-cancel="1">取消</button>' +
						"</div>" +
					"</div>";
				row.querySelector("[data-share-btn]").addEventListener("click", () => {
					const form = row.querySelector("[data-share-form]");
					form.hidden = !form.hidden;
				});
				row.querySelector("[data-cancel]").addEventListener("click", () => {
					row.querySelector("[data-share-form]").hidden = true;
				});
				row.querySelector("[data-confirm]").addEventListener("click", () => {
					const name = row.querySelector('[data-f="name"]').value.trim() || s.name;
					const desc = row.querySelector('[data-f="desc"]').value.trim();
					const cat = row.querySelector('[data-f="cat"]').value.trim() || "general";
					const btn = row.querySelector("[data-confirm]");
					btn.disabled = true; btn.textContent = "分享中…";
					madaziFetch("/skills/project/" + projectId + "/" + encodeURIComponent(fileName) + "/share", {
						method: "POST",
						body: JSON.stringify({ displayName: name, description: desc, category: cat, is_builtin: false }),
					}).then((d) => {
						if (d && d.error) { say("err", "分享失败: " + d.error); btn.disabled = false; btn.textContent = "确认分享"; return; }
						say("ok", "已分享「" + name + "」到市场，其他用户可安装");
						row.remove();
					}).catch((e) => {
						say("err", "分享失败: " + ((e && e.message) || e)); btn.disabled = false; btn.textContent = "确认分享";
					});
				});
				bodyEl.appendChild(row);
			});
		}).catch(() => {
			bodyEl.innerHTML = '<div class="madazi-members-load">加载项目技能失败</div>';
		});
	};

	// 注册 /分享技能 斜杠源（挂在官方 skill(2) 之后、ultra-slash(100) 之前）
	const installShareSkillSlash = (ctx) => {
		if (window.__madaziShareSkillInstalled) return;
		const svc = (ctx.inputTriggers && typeof ctx.inputTriggers.registerSource === "function")
			? ctx.inputTriggers
			: (typeof ctx.get === "function" ? ctx.get("inputTriggers") : null);
		if (!svc || typeof svc.registerSource !== "function") { console.warn("[madazi] inputTriggers 不可用，/分享技能 未注册"); return; }
		const source = {
			trigger: "/",
			name: "madazi-share-skill",
			order: 95,
			candidates: async (_session, req) => {
				const q = String((req && req.query) || "").trim();
				const pid = (typeof _currentProjectId === "function") ? _currentProjectId(ctx) : null;
				if (!pid) return [];
				if (q === "" || "分享技能".indexOf(q) !== -1) return [{ name: "分享技能", description: "把当前项目的技能发布到市场，供其他用户安装" }];
				return [];
			},
			onPick: () => {
				const pid = (typeof _currentProjectId === "function") ? _currentProjectId(ctx) : null;
				if (pid) openShareSkillOverlay(pid);
				return undefined; // 不落地输入框文本，直接打开分享浮层
			},
		};
		try {
			svc.registerSource(source);
			window.__madaziShareSkillInstalled = true;
		} catch (e) { console.warn("[madazi] /分享技能 注册失败:", e); }
	};
