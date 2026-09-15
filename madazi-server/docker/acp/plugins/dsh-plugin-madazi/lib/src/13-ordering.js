	// ── 会话排序引擎（显示层 CSS order 方案）
	//   背景：官方 orderBy（localStorage dsh.workspace.view.v5，默认 updated）下，
	//   侧栏显示序 = 客户端本地 account order（recency 派生），manual 模式同样本地 stored 优先
	//   —— insertSessionBefore 的服务端 sessionIds 重排在其他端不生效（reconcile 保留 stored）。
	//   故采用纯显示层：groupSection 转 flex 列 + 行 style.order，每端独立从同步数据
	//   （sessions 快照 updatedAt + 服务端 owners 元数据）计算同一目标序，零 RPC、零冲突。
	//   mode: time=updatedAt 倒序（默认）/ creator=创建人分组 / 其他=不动（官方原生序）。
	// 会话行标题提取：官方行 = [slot][title span][time span][actions]，整行 textContent
	// 会混入时间（「xxx 2小时」）导致 byId.title 匹配失败 → 只取 class 含 "title" 的 span。
	const _rowTitle = (row) => {
		for (const el of row.children) {
			if (el.tagName === "SPAN" && (el.className || "").toString().indexOf("title") !== -1) return (el.textContent || "").trim().slice(0, 64);
		}
		return (row.textContent || "").trim().slice(0, 64);
	};
	const startSessionOrdering = (ctx) => {
		if (window.__madaziOrderingStarted) return;
		window.__madaziOrderingStarted = true;
		let timer = null;
		const compute = (ids, mode, byId, owners) => {
			const arr = ids.slice();
			if (mode === "creator") {
				arr.sort((a, b) => {
					const oa = (owners[a] && owners[a].username) || "\uffff";
					const ob = (owners[b] && owners[b].username) || "\uffff";
					if (oa !== ob) return oa < ob ? -1 : 1;
					return ((byId[b] && byId[b].updatedAt) || 0) - ((byId[a] && byId[a].updatedAt) || 0);
				});
			} else {
				arr.sort((a, b) => ((byId[b] && byId[b].updatedAt) || 0) - ((byId[a] && byId[a].updatedAt) || 0));
			}
			return arr;
		};
		const applyOnce = async () => {
			const snap = ctx.sessions && ctx.sessions.list && ctx.sessions.list.getSnapshot();
			const byId = (snap && snap.byId) || {};
			// 每个项目一个 groupSection：首行=项目分组行（startRowMeta 注入 madaziProjectId）
			const sections = document.querySelectorAll('[role="treeitem"][aria-expanded]');
			for (const projRow of sections) {
				const pid = projRow.dataset && projRow.dataset.madaziProjectId;
				const section = projRow.closest('[class*="groupSection"]') || projRow.parentElement;
				if (!pid || !section) continue;
				// 本 section 的会话行：项目行之后的兄弟 treeitem（无 aria-expanded）
				const sessionRows = [];
				for (let el = projRow.nextElementSibling; el; el = el.nextElementSibling) {
					if (el.getAttribute && el.getAttribute("role") === "treeitem") {
						if (el.getAttribute("aria-expanded") !== null) break; // 下一个项目分组行
						sessionRows.push(el);
					}
				}
				const meta = await getSessionMeta(pid);
			const mode = meta && meta.sort;
			if (!mode || mode === "manual" || !sessionRows.length) {
				// 原生序：清掉历史 order 与 flex 布局，还原官方渲染
				for (const r of sessionRows) { if (r.style.order) r.style.order = ""; }
				section.classList.remove("madazi-sort-flex");
				continue;
			}
			// 行 → sessionId（chip 扫描写过的 dataset 优先；否则按 title 唯一匹配）
			const rowSid = new Map();
			for (const r of sessionRows) {
				let sid = r.dataset.madaziSid || null;
				if (!sid) {
					const title = _rowTitle(r);
					// ★ 行标题渲染用 byId[id].displayTitle（tree.ts sessionTitle），原始 title 可能不同
					const matches = title ? Object.keys(byId).filter((id) => byId[id] && !byId[id].blank && (byId[id].displayTitle === title || byId[id].title === title)) : [];
					if (matches.length === 1) sid = matches[0];
				}
				if (sid) rowSid.set(r, sid);
			}
				if (!rowSid.size) continue;
				const target = compute(Array.from(rowSid.values()), mode, byId, meta.owners || {});
				const rank = new Map(target.map((id, i) => [id, i]));
				// 未匹配行保持相对序排最前（order 默认 0），已匹配行按 rank+1
				for (const r of sessionRows) {
					const sid = rowSid.get(r);
					r.style.order = sid ? String((rank.get(sid) ?? 0) + 1) : "0";
				}
				// 溢出按钮（收起时「展开更多」）固定排最后
				for (const btn of section.querySelectorAll('[class*="sessionOverflowButton"]')) btn.style.order = "9999";
				section.classList.add("madazi-sort-flex");
			}
		};
		window.__madaziApplyOrder = () => {
			clearTimeout(timer);
			timer = setTimeout(() => applyOnce().catch(() => {}), 250);
		};
		try { ctx.workspaces && ctx.workspaces.list && ctx.workspaces.list.subscribe(() => window.__madaziApplyOrder()); } catch (e) { /* ignore */ }
		try { ctx.sessions && ctx.sessions.list && ctx.sessions.list.subscribe(() => window.__madaziApplyOrder()); } catch (e) { /* ignore */ }
		// 行重建（React 重渲染）后重新贴 order
		const mo = new MutationObserver(() => window.__madaziApplyOrder());
		mo.observe(document.body, { childList: true, subtree: true });
		window.__madaziApplyOrder();
	};

	// ── 排序开关注入官方项目行更多菜单（DOM 增强，复用官方菜单项样式）
	//   菜单归属识别：官方 Menu portal fixed 定位 ≈ 分组行 rect（bottom+4/left），行上有
	//   startRowMeta 注入的 dataset.madaziProjectId。
	const startSortMenuInject = () => {
		const MO = window.MutationObserver;
		if (!MO) return;
		// ★ 常驻 PublishHost（独立 React root）：侧栏官方菜单「发布为模板」的弹窗宿主。
		//   ProjectsEntry 只在「添加项目」弹窗打开时挂载，此前事件无监听者（点击无反应根因）。
		//   login 插件同模式（require("react-dom/client") 在壳 seed 表）；失败静默降级不影响主应用。
		if (!window.__madaziPubHost) {
			try {
				if (reactDomClient && typeof reactDomClient.createRoot === "function" && typeof document !== "undefined") {
					const host = document.createElement("div");
					host.id = "madazi-publish-host";
					document.body.appendChild(host);
					reactDomClient.createRoot(host).render(h(PublishHost));
					window.__madaziPubHost = "ok";
				} else {
					window.__madaziPubHost = "no-react-dom";
				}
			} catch (e) {
				window.__madaziPubHost = "err:" + String((e && e.message) || e);
			}
		}
		const MODES = [
			{ id: "time", label: "按时间倒序" },
			{ id: "creator", label: "按创建人排序" }
		];
		const findMenuProject = (menu) => {
			try {
				const mr = menu.getBoundingClientRect();
				const rows = document.querySelectorAll('[role="treeitem"][aria-expanded]');
				for (const row of rows) {
					const r = row.getBoundingClientRect();
					if (Math.abs(r.bottom + 4 - mr.top) < 8 && Math.abs(r.left - mr.left) < 8) {
						return (row.dataset && row.dataset.madaziProjectId) || null;
					}
				}
			} catch (e) { /* ignore */ }
			return null;
		};
		const buildItems = async (menu, pid) => {
			const viewport = menu.querySelector('[role="presentation"]') || menu;
			const refItem = menu.querySelector('[role="menuitem"]');
			if (!refItem) return;
			const meta = await getSessionMeta(pid, true);
			const current = (meta && meta.sort) || "time";
			// 分隔线
			const sep = document.createElement("div");
			sep.setAttribute("role", "separator");
			sep.style.cssText = "height:1px;margin:4px 8px;background:var(--dsw-alias-border-l2,var(--dsw-alias-border-l1))";
			viewport.appendChild(sep);
			for (const m of MODES) {
				const btn = document.createElement("button");
				btn.type = "button";
				btn.setAttribute("role", "menuitem");
				btn.className = refItem.className;
				btn.style.cssText = "width:100%";
				btn.textContent = (current === m.id ? "✓ " : "") + m.label;
				btn.addEventListener("click", (e) => {
					e.stopPropagation();
					madaziFetch("/dsh/session-sort/" + pid, { method: "PUT", body: JSON.stringify({ mode: m.id }) }).then(() => {
						invalidateMeta(pid);
						try { window.__madaziApplyOrder && window.__madaziApplyOrder(); } catch (err) { /* ignore */ }
					}).catch(() => {});
					// 触发官方 outside-pointerdown 关闭菜单
					try { document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); } catch (err) { /* ignore */ }
				});
				viewport.appendChild(btn);
			}
		};
		// ★「发布为模板」入口：点击捕获注入（不依赖几何匹配——Radix portal 菜单定位
		//   与行 rect 对不上时 MO+findMenuProject 会漏；改为点 ⋯ 时直接从行上取 pid）
		const publishInject = (menu, pid) => {
			const viewport = menu.querySelector('[role="presentation"]') || menu;
			const refItem = menu.querySelector('[role="menuitem"]');
			if (!refItem || viewport.querySelector(".madazi-menu-publish")) return;
			const sep = document.createElement("div");
			sep.setAttribute("role", "separator");
			sep.style.cssText = "height:1px;margin:4px 8px;background:var(--dsw-alias-border-l2,var(--dsw-alias-border-l1))";
			const btn = document.createElement("button");
			btn.type = "button";
			btn.setAttribute("role", "menuitem");
			btn.className = refItem.className;
			btn.classList.add("madazi-menu-publish");
			btn.style.cssText = "width:100%";
			btn.textContent = "发布为模板";
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				// 项目对象：拉平台列表按 id 匹配（失败也开向导，仅缺显示名）
				madaziFetch("/projects").then((list) => {
					const p = (Array.isArray(list) ? list : []).find((x) => x && x.id === pid);
					window.dispatchEvent(new CustomEvent("madazi-publish-template", { detail: { id: pid, name: p ? (p.name || "") : "" } }));
				}).catch(() => {
					window.dispatchEvent(new CustomEvent("madazi-publish-template", { detail: { id: pid, name: "" } }));
				});
				// 触发官方 outside-pointerdown 关闭菜单
				try { document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); } catch (err) { /* ignore */ }
			});
			viewport.appendChild(sep);
			viewport.appendChild(btn);
			console.log("[madazi] publish menu item injected, pid:", pid);
		};
		const tryPublishInject = (pid, attempt) => {
			if (attempt > 8) return;
			// 最新出现的菜单 = 刚打开的这个（Radix 关闭后卸载，无残留）。
			// ★ 不按 data-madazi-publish 标记过滤：路径 2 会先标记再注入，若过滤会自锁
			//   （标记过的菜单被排除 → 重试 8 次放弃 → 永远注入不进去）。
			//   去重由 publishInject 内部 .madazi-menu-publish 检查负责。
			const menus = Array.from(document.querySelectorAll('div[role="menu"]'));
			const menu = menus.length ? menus[menus.length - 1] : null;
			if (!menu || !menu.querySelector('[role="menuitem"]')) { setTimeout(() => tryPublishInject(pid, attempt + 1), 150); return; }
			publishInject(menu, pid);
		};
		// ★ 项目名提取：分组行第 3 子元素内的 span（与 startRowMeta 同源结构：
		//   [chevron][folder svg][标题容器>span]），aria-label 兜底（可能只是「操作」无项目名）
		const rowProjectName = (row) => {
			if (!row) return null;
			const pt = row.children && row.children[2];
			const titleEl = pt && pt.querySelector ? pt.querySelector("span") : null;
			const n = (titleEl ? titleEl.textContent : (pt ? pt.textContent : "")).trim();
			if (n) return n;
			return null;
		};
		const labelProjectName = (btn) => {
			const label = btn.getAttribute("aria-label") || "";
			return (label.match(/[“"'']([^”"'']+)["'']/) || [])[1] || null;
		};
		// 几何兜底：⋯ 按钮可能不在 treeitem DOM 内（兄弟容器渲染）——按钮中心点落在哪个分组行
		const geomRow = (btn) => {
			try {
				const br = btn.getBoundingClientRect();
				const cy = br.top + br.height / 2;
				for (const r of document.querySelectorAll('[role="treeitem"][aria-expanded]')) {
					const rr = r.getBoundingClientRect();
					if (rr.height > 0 && cy >= rr.top && cy <= rr.bottom && br.left >= rr.left - 4 && br.left <= rr.right + 4) return r;
				}
			} catch (e) { /* ignore */ }
			return null;
		};
		// 按项目名解析 pid 后注入（列表按名匹配；file 子目录名匹配不到自然过滤）
		const tryPublishInjectByName = (name) => {
			if (!name) return;
			madaziFetch("/projects").then((list) => {
				const p = (Array.isArray(list) ? list : []).find((x) => x && x.name === name);
				if (p) { console.log("[madazi] publish inject by name:", name); tryPublishInject(p.id, 0); }
			}).catch(() => {});
		};
		window.__madaziPubMenu = "v4";
		// 路径 1（点击捕获）：点分组行 icon 按钮 → 记录项目名 → 菜单弹出后注入
		document.body.addEventListener("click", (e) => {
			const btn = e.target && e.target.closest ? e.target.closest("button") : null;
			if (!btn || (btn.textContent || "").trim().length > 4) return; // 只认 icon 按钮（⋯/空文本）
			const row = (btn.closest ? btn.closest('[role="treeitem"][aria-expanded]') : null) || geomRow(btn);
			if (!row) return;
			const name = rowProjectName(row) || labelProjectName(btn);
			if (!name) return;
			window.__madaziLastProjName = name;
			if (row.dataset && row.dataset.madaziProjectId) {
				setTimeout(() => tryPublishInject(row.dataset.madaziProjectId, 0), 120);
			} else {
				setTimeout(() => tryPublishInjectByName(name), 120);
			}
		}, true);
		const mo = new MO(() => {
			for (const menu of document.querySelectorAll('div[role="menu"]')) {
				const items = menu.querySelectorAll('[role="menuitem"]');
				if (!items.length) continue;
				const texts = Array.from(items).map((b) => (b.textContent || "").trim());
				// 路径 2（菜单内容特征）：项目行菜单必含「删除项目」（locale 覆盖后；
				//   合并前的短窗口内仍是「删除工作区」，一并识别）→ 注入「发布为模板」
				if (!menu.dataset.madaziPublish) {
					const isProjectMenu = texts.some((s) => s.indexOf("删除项目") !== -1 || s.indexOf("删除工作区") !== -1 || s.indexOf("Delete project") !== -1 || s.indexOf("Delete workspace") !== -1);
					if (isProjectMenu) {
						menu.dataset.madaziPublish = "1"; // 仅防 MO 自身重入；注入去重靠 publishInject 内部检查
						// pid 解析优先级：菜单几何匹配行 → 点击时记录的项目名；拿到 pid 直接注入
						const pid2 = findMenuProject(menu);
						if (pid2) publishInject(menu, pid2);
						else if (window.__madaziLastProjName) tryPublishInjectByName(window.__madaziLastProjName);
					}
				}
				// 排序开关注入（原有逻辑）
				if (menu.dataset.madaziSort === "done") continue;
				const isProjectMenu2 = texts.some((s) => s.indexOf("删除项目") !== -1 || s.indexOf("Delete project") !== -1);
				if (!isProjectMenu2) continue;
				menu.dataset.madaziSort = "done";
				const pid = findMenuProject(menu);
				if (pid) buildItems(menu, pid);
			}
		});
		mo.observe(document.body, { childList: true, subtree: true });
	};

	// ── 侧栏任务行创建人 chip（DOM 注入；title 唯一匹配 session）
	const startSessionOwnerChips = (ctx) => {
		const scan = async () => {
			const rows = document.querySelectorAll('[role="treeitem"]');
			for (const row of rows) {
				if (row.getAttribute("aria-expanded") !== null) continue; // 分组行
				if (row.dataset.madaziOwnerChip) continue;
				const snap = ctx.sessions && ctx.sessions.list && ctx.sessions.list.getSnapshot();
				const byId = (snap && snap.byId) || {};
				const title = _rowTitle(row);
				if (!title) continue;
				const matches = Object.keys(byId).filter((id) => byId[id] && !byId[id].blank && (byId[id].displayTitle === title || byId[id].title === title));
				if (matches.length !== 1) continue; // 重名/blank 不注（重命名后行重建会重扫）
				const sid = matches[0];
				// 所属项目：workspaces 快照反查（★ 不能靠向前找兄弟 treeitem——官方每个
				// treeitem 行独立包在 SPAN 容器，行间非兄弟，madaziProjectId 拿不到）
				const pid = _pidOfSession(ctx, sid);
				if (!pid) continue;
				const meta = await getSessionMeta(pid);
				const owner = meta && meta.owners && meta.owners[sid];
				if (!owner) continue; // 上报完成前 owner 未知：不标记，meta 失效后重扫补
				row.dataset.madaziOwnerChip = "1";
				// title 元素：行内文本等于 session 显示标题的 span（displayTitle，非原始 title）
				let titleEl = null;
				for (const el of row.children) {
					if (el.tagName === "SPAN" && (el.textContent || "").trim() === byId[sid].displayTitle) { titleEl = el; break; }
				}
				const chip = document.createElement("span");
				chip.className = "madazi-row-owner";
				chip.title = "创建人 " + owner.username;
				const av = document.createElement("i");
				av.style.background = avatarBg(owner.username);
				av.textContent = (owner.username[0] || "?").toUpperCase();
				const nm = document.createElement("b");
				nm.textContent = owner.username;
				chip.appendChild(av);
				chip.appendChild(nm);
				if (titleEl && titleEl.nextSibling) row.insertBefore(chip, titleEl.nextSibling);
				else row.appendChild(chip);
			}
		};
		const mo = new MutationObserver(() => { scan().catch(() => {}); });
		mo.observe(document.body, { childList: true, subtree: true });
		// 上报完成回调（meta 失效后重扫补 chip）：多个扫描器共享同一全局入口
		window.__madaziRescans = window.__madaziRescans || [];
		window.__madaziRescans.push(() => scan().catch(() => {}));
		window.__madaziRescan = window.__madaziRescan || (() => {
			for (const fn of window.__madaziRescans) { try { fn(); } catch (e) { /* ignore */ } }
		});
		scan().catch(() => {});
	};

	// ── 对话气泡发送人（DOM 注入：user 气泡行前插署名；文本前缀对齐 sender）
	// ★ 2026-09-04 适配 0.1.2 DOM：user 气泡外层 textContent 含时间戳（「启动项目8月31日 16:25」），
	//   与上报存的纯正文前缀不一致 → 匹配永远失败（dsh_message_senders 0 行根因）。
	//   正文稳定锚点 = user 气泡内 [class*="bubble"] 元素（0.1.2: Sixlwa_bubble）。
	//   回退：过滤日期时间戳（如「8月31日 16:25」「2026-09-04 12:00」）后的 textContent。
	const _senderPrefixOf = (row) => {
		try {
			const b = row.querySelector('[class*="bubble"]');
			if (b && (b.textContent || "").trim()) return _normPrefix(b.textContent);
		} catch (e) { /* ignore */ }
		return _normPrefix(String(row.textContent || "").replace(/\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}\s*\d{1,2}:\d{2}/g, ""));
	};
	const startBubbleSenders = (ctx) => {
		// ★ 2026-09-04 发完即显修复：服务端网关记录（server 直接入库）不走前端 madaziFetch，
		//   不触发 invalidateMeta → scan 读的 session-meta 是旧 60s 缓存，新消息署名缺失要等过期。
		//   这里对「当前项目有未署名 user 气泡」做限流 force 重取（3s 节流），再重扫补插。
		let _lastForceAt = 0;
		const scan = async (opts) => {
			const rows = document.querySelectorAll('[data-chat-flow-kind="user"]');
			if (!rows.length) return;
			const snap = ctx.sessions && ctx.sessions.list && ctx.sessions.list.getSnapshot();
			const sid = snap && snap.current;
			if (!sid) return;
			const pid = _currentProjectId(ctx);
			const pending = window.__madaziPendingSender || new Map();
			let meta = null;
			let missing = false;
			for (const row of rows) {
				const prev = row.previousElementSibling;
				if (prev && prev.classList && prev.classList.contains("madazi-sender")) continue; // 已注入
				const prefix = _senderPrefixOf(row);
				if (!prefix) continue;
				let sender = pending.get(sid + "\n" + prefix);
				if (!sender) {
					if (!meta && pid) meta = await getSessionMeta(pid);
					if (meta && meta.byPrefix) sender = meta.byPrefix[sid + "\n" + prefix];
				}
				if (!sender) { missing = true; continue; } // 有未署名的新气泡 → 触发 force
				const el = document.createElement("div");
				el.className = "madazi-sender";
				const av = document.createElement("i");
				av.style.background = avatarBg(sender.username);
				av.textContent = (sender.username[0] || "?").toUpperCase();
				const nm = document.createElement("span");
				nm.textContent = sender.username;
				el.appendChild(av);
				el.appendChild(nm);
				row.parentNode && row.parentNode.insertBefore(el, row);
			}
			// 限流 force：当前项目 + 有未署名气泡 + 3s 节流内未 force 过 → 拉新 meta 后重扫补插
			if (missing && pid && !(opts && opts.forceDone) && Date.now() - _lastForceAt > 3000) {
				_lastForceAt = Date.now();
				try {
					await getSessionMeta(pid, true); // force 写回 _metaCache
					await scan({ forceDone: true }); // 用新缓存重扫，补插署名
				} catch (e) { /* 重取失败等下次 mutation */ }
			}
		};
		const mo = new MutationObserver(() => { scan().catch(() => {}); });
		mo.observe(document.body, { childList: true, subtree: true });
		window.__madaziRescans = window.__madaziRescans || [];
		window.__madaziRescans.push(() => scan().catch(() => {}));
		window.__madaziRescan = window.__madaziRescan || (() => {
			for (const fn of window.__madaziRescans) { try { fn(); } catch (e) { /* ignore */ } }
		});
		scan().catch(() => {});
	};
