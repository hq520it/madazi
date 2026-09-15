		const injectMeta = (row, label) => {
			// 重扫到的行可能带着上次「非成员误隐藏」的 display:none（如 uuid 标题期被藏）→ 先解除
			row.style.display = "";
			// 官方行是 flex nowrap：子行要另起一行必须允许 wrap
			row.style.flexWrap = "wrap";
			row.style.height = "auto";
			// ★ 会话行跟随项目行显示/隐藏：项目行之后、下一个项目行之前的兄弟 treeitem 即本项目会话行。
			//   非成员项目 → 隐藏项目行 + 会话行（杜绝「看到其他项目会话但不知归属」）；
			//   成员项目 → 恢复历史隐藏的会话行（被加进项目后重扫自动恢复）。
			const setSectionHidden = (hide) => {
				for (let el = row.nextElementSibling; el; el = el.nextElementSibling) {
					if (el.getAttribute && el.getAttribute("role") === "treeitem" && el.getAttribute("aria-expanded") !== null) break;
					if (hide) { el.style.display = "none"; if (el.dataset) el.dataset.madaziMemberHidden = "1"; }
					else if (el.dataset && el.dataset.madaziMemberHidden) { el.style.display = ""; delete el.dataset.madaziMemberHidden; }
				}
			};
			const sub = document.createElement("div");
			sub.className = "madazi-ws-subrow";
			sub.innerHTML = '<span class="madazi-ws-loading">…</span>';
			sub.addEventListener("click", (e) => e.stopPropagation());
			row.appendChild(sub);
			const fail = () => { sub.remove(); if (row.dataset) row.dataset.madaziMetaDone = ""; };
			madaziFetch("/projects").then((list) => {
				const projects = Array.isArray(list) ? list : [];
				// ★ 项目归属按 workspace 路径解析，绝不因「标题≠项目名」误藏分组行：
				//   侧栏「项目重命名」只改 dsh 工作区标题（workspace.title），项目名
				//   （projects.name）不变 → 旧按 name 匹配在改名后必然失败 → 分组行被
				//   display:none 整组藏起来（本 bug）。身份锚点应是 path 里的 projectId，
				//   path 在重命名/刷新均不变；成员可见性已由更可靠的
				//   __madaziGatedWorkspaces 路径门禁负责，这里不再按名字隐藏。
				const svc = window.__madaziWs || (_madaziCtx && _madaziCtx.workspaces);
				const snap = (svc && svc.list && typeof svc.list.getSnapshot === "function") ? svc.list.getSnapshot() : null;
				const wsItems = (snap && snap.items) || [];
				const ws = wsItems.find((w) => w && w.title === label);
				const wsPath = (ws && typeof ws.path === "string" ? ws.path : "").replace(/\/+$/, "");
				const pathPid = wsPath ? (wsPath.split("/").pop() || "") : "";
				const p = (pathPid && projects.find((x) => x && x.id === pathPid))
					|| projects.find((x) => x && x.name === label); // 非平台路径工作区兜底按名匹配
				if (!p) {
					// 请求失败/异常，或确非本用户可见项目：仅移除加载子行，不隐藏分组行
					if (!Array.isArray(list)) { fail(); return null; }
					fail();
					return null;
				}
				row.dataset.madaziMember = "1"; // ★ 成员项目
				setSectionHidden(false); // ★ 成员项目：恢复该组会话行显示
				row.dataset.madaziProjectId = p.id;
				return Promise.all([madaziFetch("/projects/" + p.id + "/members"), madaziFetch("/auth/me")]).then(([mv, mev]) => {
					if (!mv || !mv.owner) { fail(); return null; }
					sub.innerHTML = "";
					const owner = mv.owner;
					const ownerEl = document.createElement("span");
				ownerEl.className = "madazi-ws-owner";
				ownerEl.title = "创建人 " + (owner.username || "");
				const av = document.createElement("span");
				av.className = "madazi-ws-avatar";
				av.style.background = avatarBg(owner.username);
				av.textContent = letterOf(owner.username);
					const nm = document.createElement("span");
					nm.className = "madazi-ws-owner-name";
					nm.textContent = owner.username || "";
					ownerEl.appendChild(av); ownerEl.appendChild(nm);
					sub.appendChild(ownerEl);
					// 在线成员头像区（只显示在线成员，30s 刷新）
					const avatars = document.createElement("span");
					avatars.className = "madazi-ws-avatars";
					sub.appendChild(avatars);
					const addBtn = document.createElement("button");
					addBtn.className = "madazi-ws-add";
					addBtn.type = "button";
					addBtn.title = "管理项目成员";
					addBtn.textContent = "+";
					addBtn.addEventListener("click", (e) => { e.stopPropagation(); openMembersOverlay(p.id, p.name); });
					sub.appendChild(addBtn);
					const memberList = Array.isArray(mv.members) ? mv.members : [];
					const renderOnline = (users) => {
						const uids = new Set((users || []).map((u) => u && (u.id || u.user_id)));
						const online = memberList.filter((m) => uids.has(m.user_id));
						// 创建人在线 → 绿点
						av.classList.toggle("madazi-ws-online", uids.has(owner.user_id));
						ownerEl.title = "创建人 " + (owner.username || "") + (uids.has(owner.user_id) ? " · 在线" : "");
						avatars.innerHTML = "";
						const shown = online.slice(0, 6);
					for (const mb of shown) {
						const a = document.createElement("span");
						a.className = "madazi-ws-mavatar madazi-ws-online";
						a.style.background = avatarBg(mb.username);
						a.title = (mb.username || "") + " · 在线" + (mb.role === "admin" ? " · 项目管理员" : "");
						a.textContent = letterOf(mb.username);
						avatars.appendChild(a);
					}
						if (online.length > 6) {
							const more = document.createElement("span");
							more.className = "madazi-ws-mavatar madazi-ws-more";
							more.title = "共 " + online.length + " 名成员在线";
							more.textContent = "+" + (online.length - 6);
							avatars.appendChild(more);
						}
						if (!online.length) avatars.style.display = "none"; else avatars.style.display = "";
					};
					// 登录即在线：渲染 成员 ∩ 全局在线（首帧可能为空，WS 连接后立即全量广播）
					renderOnline(_globalOnline);
					const unsub = _subscribeOnline("__g__", () => {
						if (!row.isConnected) { unsub(); return; }
						renderOnline(_globalOnline);
					});
					return null;
				});
			}).catch(() => { fail(); });
		};
		// DOM 版成员管理浮层（sidebar 行加号用；React 版 MembersModal 服务于项目列表 ⋯ 菜单）
		const openMembersOverlay = (projectId, projectName) => {
			if (document.querySelector(".madazi-members-overlay")) return;
			const ov = document.createElement("div");
			ov.className = "madazi-members-overlay";
			ov.innerHTML =
				'<div class="madazi-members-dialog">' +
				'<div class="madazi-members-hd"><span>管理项目成员 · ' + escHtml(projectName) + '</span><button type="button" class="madazi-members-close">✕</button></div>' +
				'<div class="madazi-members-body"><div class="madazi-members-load">加载中…</div></div>' +
				'<div class="madazi-members-foot">' +
					'<div class="madazi-members-roles">' +
						'<button type="button" class="madazi-role-btn" data-role="admin">设为管理员</button>' +
						'<button type="button" class="madazi-role-btn on" data-role="developer">设为开发者</button>' +
					'</div>' +
					'<input class="madazi-members-q" placeholder="按用户名搜索添加成员…" autocomplete="off" />' +
					'<div class="madazi-members-results"></div>' +
				'</div>' +
				'</div>';
			document.body.appendChild(ov);
			const close = () => ov.remove();
			ov.querySelector(".madazi-members-close").addEventListener("click", close);
			ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
			// ★ 添加成员角色选择（默认开发者；高亮当前选中）
			let addRole = "developer";
			ov.querySelectorAll(".madazi-role-btn").forEach((b) => {
				b.addEventListener("click", () => {
					addRole = b.dataset.role;
					ov.querySelectorAll(".madazi-role-btn").forEach((x) => x.classList.toggle("on", x === b));
				});
			});
			const body = ov.querySelector(".madazi-members-body");
			const q = ov.querySelector(".madazi-members-q");
			const results = ov.querySelector(".madazi-members-results");
			let mev = null;
			let data = null;
			const render = () => {
				if (!data) return;
				const meu = mev && (mev.user || mev); // /auth/me 返回 {user}
				const meId = meu && (meu.id || meu.user_id);
				const members = data.members || [];
				const canManage = !!meId && (data.owner.user_id === meId || (meu && meu.role === "admin") || members.some((x) => x.user_id === meId && x.role === "admin"));
				// ★ 移除权限收紧：仅创建人 + 平台管理员可移除；项目管理员可加人/改角色但不能移除
				const canRemove = !!meId && (data.owner.user_id === meId || (meu && meu.role === "admin"));
				const dot = (uid) => "";
				let html = '<div class="madazi-user-row"><div style="display:flex;gap:8px;align-items:center"><span class="madazi-dot"></span><span class="un">' + escHtml(data.owner.username) + '</span><span class="madazi-role-badge">创建人</span></div><span class="meta">创建人</span></div>';
				html += members.map((m) =>
					'<div class="madazi-user-row"><div style="display:flex;gap:8px;align-items:center"><span class="madazi-dot"></span><span class="un">' + escHtml(m.username) + '</span><span class="madazi-role-badge">' + (m.role === "admin" ? "项目管理员" : "开发者") + "</span></div>" +
					(canManage && m.user_id !== data.owner.user_id
						? '<span style="display:flex;gap:6px;align-items:center">' +
							'<button type="button" class="madazi-btn-ghost" data-act="role" data-uid="' + m.user_id + '">' + (m.role === "admin" ? "设为开发者" : "设为管理员") + "</button>" +
							(canRemove ? '<button type="button" class="madazi-btn-danger" data-act="rm" data-uid="' + m.user_id + '">移除</button>' : "") + "</span>"
						: '<span class="meta"></span>') +
					"</div>"
				).join("");
				body.innerHTML = html;
				body.querySelectorAll("[data-act]").forEach((btn) => {
				btn.addEventListener("click", (ev) => {
					ev.stopPropagation(); // ★ 防止冒泡到全局捕获监听（误触发用户菜单等）
					const uid = btn.dataset.uid;
					if (btn.dataset.act === "rm") { act(() => madaziFetch("/projects/" + projectId + "/members/" + uid, { method: "DELETE" }), "已移除"); }
					else { act(() => madaziFetch("/projects/" + projectId + "/members/" + uid, { method: "PATCH", body: JSON.stringify({ role: btn.textContent.indexOf("管理员") !== -1 ? "admin" : "developer" }) }), "已更新角色"); }
				});
			});
			};
			const act = (fn, okMsg) => {
				body.innerHTML = '<div class="madazi-members-load">处理中…</div>';
				fn().then((d) => {
					const v = d;
					if (v && v.error) { body.innerHTML = '<div class="madazi-members-load madazi-err">' + escHtml(typeof v.error === "object" ? JSON.stringify(v.error) : v.error) + "</div>"; return; }
					reload();
				}).catch((e) => { body.innerHTML = '<div class="madazi-members-load madazi-err">' + escHtml(String((e && e.message) || e)) + "</div>"; });
			};
			const reload = () => {
				body.innerHTML = '<div class="madazi-members-load">加载中…</div>';
				Promise.all([madaziFetch("/projects/" + projectId + "/members"), madaziFetch("/auth/me")]).then(([m, me]) => {
					data = m;
					mev = me;
					if (!data || !data.owner) { body.innerHTML = '<div class="madazi-members-load madazi-err">加载失败</div>'; return; }
					render();
				}).catch((e) => { body.innerHTML = '<div class="madazi-members-load madazi-err">' + escHtml(String((e && e.message) || e)) + "</div>"; });
			};
			reload();
			let deb = null;
			q.addEventListener("input", () => {
				clearTimeout(deb);
				const t = q.value.trim();
				if (!t) { results.innerHTML = ""; return; }
				deb = setTimeout(() => {
					results.innerHTML = '<div class="madazi-members-load">搜索中…</div>';
					madaziFetch("/projects/" + projectId + "/members/search?q=" + encodeURIComponent(t)).then((d) => {
						const v = d;
						const arr = Array.isArray(v) ? v : [];
						results.innerHTML = arr.length === 0
							? '<div class="madazi-members-load">无匹配用户</div>'
							: arr.map((u) => '<div class="madazi-proj" style="display:flex;justify-content:space-between;align-items:center"><span class="madazi-proj-n">' + escHtml(u.username) + '</span><button type="button" class="madazi-newbtn" style="margin:0;padding:2px 8px">添加</button></div>').join("");
						results.querySelectorAll(".madazi-proj").forEach((rowEl, idx) => {
						rowEl.querySelector("button").addEventListener("click", (ev) => {
							ev.stopPropagation(); // ★ 防冒泡误触发全局监听
							const u = arr[idx];
							rowEl.querySelector("button").disabled = true;
								madaziFetch("/projects/" + projectId + "/members", { method: "POST", body: JSON.stringify({ username: u.username, role: addRole }) }).then((r2) => {
									const v2 = r2 && r2.ok ? r2.value : r2;
									if (v2 && v2.error) { rowEl.querySelector("button").textContent = "失败"; return; }
									rowEl.querySelector("button").textContent = "已添加" + (addRole === "admin" ? "（管理员）" : "（开发者）");
									results.innerHTML = "";
									q.value = "";
									reload();
								}).catch(() => { rowEl.querySelector("button").textContent = "失败"; });
							});
						});
					}).catch(() => { results.innerHTML = '<div class="madazi-members-load madazi-err">搜索失败</div>'; });
				}, 300);
			});
		};

		// ★ 会话可见性「单一裁决器」（2026-08-27 v2，取代一次性标注+被动执法）：
		//   浏览器内存 store 由 WS 推送全量会话（events WS 豁免直达 pod，红线不改），
		//   所以显示层自建权威裁决，语义与 server 数据层拦截一致（fail-closed）：
		//   R1 组作用域：分组头之后、下一个分组头之前的兄弟 treeitem 随组头 madaziMember
		//      三态联动（"1"显示/"0"压制/未标不动防误伤）；React 重渲染冲掉就再压回。
		//   R2 游离行 fail-closed：向前无分组头的会话行必须自证归属（title 精确唯一匹配
		//      byId + cwd 落在成员项目）才显示；blank 本地草稿放行；证明不了的隐藏
		//      （重名/store 未就绪/已移除项目的孤儿历史会话——历史上靠 title 匹配失败
		//      「continue」全漏网，v2 反转为默认隐藏）。
		//   R3 启动遮蔽：首轮裁决前树区 visibility:hidden（不 display:none，布局不跳动），
		//      项目表到手即揭幕；接口 4s 兜底强制揭幕（宁可一瞬闪烁不白屏）。
		const startUngroupedSessionFilter = (ctx) => {
			if (window.__madaziUngroupedFilter) return;
			window.__madaziUngroupedFilter = true;
			// ── R3 启动遮蔽（幂等注入，越早越好）──
			if (!document.getElementById("madazi-boot-veil")) {
				document.documentElement.setAttribute("data-madazi-boot", "1");
				const st = document.createElement("style");
				st.id = "madazi-boot-veil";
				st.textContent = 'html[data-madazi-boot="1"] [role="tree"]{visibility:hidden!important}';
				document.head.appendChild(st);
				setTimeout(() => { document.documentElement.removeAttribute("data-madazi-boot"); }, 4000);
			}
			let projById = null;
			let projAt = 0;
			const loadProjects = () => {
				if (projById && Date.now() - projAt < 30000) return Promise.resolve(projById);
				return madaziFetch("/projects").then((list) => {
					const m = new Map();
					for (const p of Array.isArray(list) ? list : []) m.set(p.id, p);
					projById = m; projAt = Date.now();
					document.documentElement.removeAttribute("data-madazi-boot"); // 项目表到手即揭幕
					return m;
				}).catch(() => { document.documentElement.removeAttribute("data-madazi-boot"); return projById || new Map(); });
			};
			// R1 主扫描：组作用域整组压制/恢复（不依赖 sessions 快照，任何时刻安全执行）
			const enforceGroups = () => {
				const heads = document.querySelectorAll('[role="treeitem"][aria-expanded]');
				for (const head of heads) {
					const ds = head.dataset || {};
					const member = ds.madaziMember === "0" ? false : (ds.madaziMember === "1" || ds.madaziProjectId) ? true : null;
					if (member === null) continue; // 未判定（官方原生行/请求失败）：不动
					for (let el = head.nextElementSibling; el; el = el.nextElementSibling) {
						if (el.getAttribute && el.getAttribute("role") === "treeitem" && el.getAttribute("aria-expanded") !== null) break;
						if (!el.getAttribute || el.getAttribute("role") !== "treeitem") continue;
						if (!member) { if (el.dataset && !el.dataset.madaziMemberHidden) el.dataset.madaziMemberHidden = "1"; el.style.display = "none"; }
						else if (el.dataset && el.dataset.madaziMemberHidden) { delete el.dataset.madaziMemberHidden; el.style.display = ""; }
					}
				}
			};
			// R2 副扫描：游离行 fail-closed（每轮全量复核，身份变化即时恢复/压制）
			const scanOrphans = async () => {
				try {
					const projects = await loadProjects();
					if (!projects.size) return; // 项目表不可用：不执法（fail-open 防全藏白屏）
					const snap = ctx.sessions && ctx.sessions.list && ctx.sessions.list.getSnapshot();
					const byId = (snap && snap.byId) || {};
					for (const row of document.querySelectorAll('[role="treeitem"]')) {
						if (!row.getAttribute || row.getAttribute("aria-expanded") !== null) continue;
						let anchored = false;
						for (let prev = row.previousElementSibling; prev; prev = prev.previousElementSibling) {
							if (prev.getAttribute && prev.getAttribute("role") === "treeitem" && prev.getAttribute("aria-expanded") !== null) { anchored = true; break; }
						}
						if (anchored) continue; // R1 已管
						const isHidden = !!(row.dataset && row.dataset.madaziMemberHidden === "1");
						const ok = (() => {
							const title = (row.textContent || "").trim().slice(0, 64);
							if (!title) return false;
							const all = Object.keys(byId).filter((id) => byId[id] && byId[id].title === title);
							if (all.length !== 1) return false; // 解析不了（重名/未就绪）→ 不放行
							const ent = byId[all[0]];
							if (ent.blank) return true; // blank 本地草稿：用户自己的，放行
							const cwd = typeof ent.cwd === "string" ? ent.cwd.replace(/\/+$/, "") : "";
							const m = cwd.match(/generated\/([0-9a-fA-F-]{36})$/);
							return !!(m && projects.has(m[1]));
						})();
						if (ok) { if (isHidden) { delete row.dataset.madaziMemberHidden; row.style.display = ""; } continue; }
						if (!isHidden) { if (row.dataset) row.dataset.madaziMemberHidden = "1"; row.style.display = "none"; }
					}
				} catch (e) { /* ignore */ }
			};
			let timer = 0;
			const rescan = () => {
				clearTimeout(timer);
				timer = setTimeout(() => { enforceGroups(); scanOrphans().catch(() => {}); }, 60); // 短 debounce：中途推送 ≤1 帧微闪
			};
			// 被加进项目后：全量重扫（恢复历史隐藏的会话）
			window.__madaziUngroupedRescan = rescan;
			try { ctx.sessions && ctx.sessions.list && ctx.sessions.list.subscribe(() => rescan()); } catch (e) { /* ignore */ }
			const mo = new MutationObserver(() => { rescan(); });
			mo.observe(document.body, { childList: true, subtree: true });
			rescan();
		};

		const waitReadyThenOpen = (pid, tryOpen) => {
			let n = 0;
			const iv = setInterval(() => {
				n++;
				window.__madaziSvc.previewStatus(pid).then((d) => {
					const v = d && d.ok ? d.value : d;
					if (v && (v.running || v.status === "running")) { clearInterval(iv); tryOpen(); }
					else if (n > 20) { clearInterval(iv); tryOpen(); }
				}).catch(() => { if (n > 20) { clearInterval(iv); tryOpen(); } });
			}, 1500);
		};
