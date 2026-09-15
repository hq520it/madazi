		// S7 插件市场组件。★ 必须定义在 factory 闭包内：它使用闭包内解构的
		// useState/useEffect/react/madaziFetch 等，放在闭包外会 ReferenceError
		// （useState is not defined）。
		const MarketSection = ({ close }) => {
			const [installed, setInstalled] = useState(null);
			const [q, setQ] = useState("");
			const [results, setResults] = useState(null);
			const [searching, setSearching] = useState(false);
			const [prechecks, setPrechecks] = useState({});
			const [busyName, setBusyName] = useState(null);
			const [msg, setMsg] = useState(null);
			// ★ 市场数据层直连 server API（浏览器同源 cookie 鉴权，与成员管理浮层同模式）：
			//   原 window.__madaziSvc.marketXxx 走 node 半 SVC_TOKEN（缺失/24h 过期即 401），
			//   且 market 组 RPC 在 typert 契约文件（typert.host.js / TYPERT_REMOTE）中未登记，路由 404。
			const mkt = (path, opts) => madaziFetch(path, opts).then((d) => {
				if (d && d.error) throw new Error(typeof d.error === "object" ? JSON.stringify(d.error) : d.error);
				return d;
			});
			const loadInstalled = () => {
				mkt("/admin/plugins").then((v) => {
					setInstalled(Array.isArray(v) ? v : (v && v.plugins) || []);
				}).catch((e) => setMsg({ type: "err", text: "已装列表加载失败: " + String((e && e.message) || e) }));
			};
			useEffect(() => { loadInstalled(); }, []);
			const doSearch = () => {
				if (!q.trim() || searching) return;
				setSearching(true); setResults(null); setMsg(null);
				mkt("/admin/plugins/search?q=" + encodeURIComponent(q.trim())).then((v) => {
					setResults(Array.isArray(v) ? v : (v && v.results) || []);
				}).catch((e) => setMsg({ type: "err", text: "搜索失败: " + String((e && e.message) || e) })).finally(() => setSearching(false));
			};
			const doPrecheck = (name) => {
				setPrechecks((prev) => ({ ...prev, [name]: { loading: true } }));
				mkt("/admin/plugins/precheck?name=" + encodeURIComponent(name)).then((v) => {
					setPrechecks((prev) => ({ ...prev, [name]: v }));
				}).catch((e) => setPrechecks((prev) => ({ ...prev, [name]: { error: String((e && e.message) || e) } })));
			};
			const doInstall = (name, version) => {
				if (busyName) return;
				setBusyName(name); setMsg(null);
				mkt("/admin/plugins/install", { method: "POST", body: JSON.stringify(version ? { name, version } : { name }) }).then((v) => {
					if (v && v.ok === false && v.rollback) {
						setMsg({ type: "err", text: "安装失败（verify 未通过已自动回滚）: " + ((v.verify && v.verify.detail) || "").slice(0, 200) });
					} else if (v && v.ok === false) {
						setMsg({ type: "err", text: "安装失败: " + String((v.error || (v.verify && v.verify.detail) || "")).slice(0, 200) });
					} else {
						setMsg({ type: "ok", text: "已安装 " + name + (v && v.version ? " (" + v.version + ")" : "") + (v && v.verify && v.verify.ok ? " ✓ 握手验证通过" : "") + "——点下方「重启 dsh-web 生效」使其进入启动树" });
					}
					loadInstalled();
				}).catch((e) => setMsg({ type: "err", text: "安装失败: " + String((e && e.message) || e) })).finally(() => setBusyName(null));
			};
			const doToggle = (name, enable) => {
				mkt("/admin/plugins/" + (enable ? "enable" : "disable"), { method: "POST", body: JSON.stringify({ name }) }).then((v) => {
					setMsg({ type: v && v.ok === false ? "err" : "ok", text: v && v.ok === false ? ("操作失败: " + (v.error || "")) : (enable ? "已启用 " + name : "已停用 " + name) });
					loadInstalled();
				}).catch((e) => setMsg({ type: "err", text: String((e && e.message) || e) }));
			};
			const doUninstall = (name) => {
				if (busyName) return;
				setBusyName(name); setMsg(null);
				mkt("/admin/plugins/uninstall", { method: "POST", body: JSON.stringify({ name }) }).then((v) => {
					setMsg({ type: v && v.ok === false ? "err" : "ok", text: v && v.ok === false ? ("卸载失败: " + (v.error || "")) : "已卸载 " + name });
					loadInstalled();
				}).catch((e) => setMsg({ type: "err", text: "卸载失败: " + String((e && e.message) || e) })).finally(() => setBusyName(null));
			};
			// ★ 重启 dsh-web 使新装插件进 boot 树（dsh web 进程缓存旧树，不重启不生效）。
			//   DELETE pod → deployment 自动重建；轮询就绪期间 /api/admin/* 走 traefik
			//   平台家族直达 server，不经过 dsh-web pod，本页轮询不受重启影响。
			const [restartState, setRestartState] = useState(null);
			const [restartConfirm, setRestartConfirm] = useState(false);
			const doRestart = () => {
				if (restartState) return;
				setRestartConfirm(false);
				setRestartState("waiting"); setMsg(null);
				mkt("/admin/plugins/restart", { method: "POST" }).then(() => {
					const t0 = Date.now();
					const fail = () => { setRestartState(null); setMsg({ type: "err", text: "等待重启超时（90s），请检查 pod 状态后重试" }); };
					const poll = () => {
						mkt("/admin/plugins/restart/status").then((v) => {
							if (v && v.ready) {
								setRestartState(null);
								// ★ Ready 后提示 + 自动刷新：boot 树随页面加载注入，运行中页面不感知新插件
								setMsg({ type: "ok", text: "dsh-web 已重启完成——即将自动刷新加载新插件…" });
								setTimeout(() => window.location.reload(), 2000);
							} else if (Date.now() - t0 > 90000) fail();
							else setTimeout(poll, 1500);
						}).catch(() => { if (Date.now() - t0 > 90000) fail(); else setTimeout(poll, 2000); });
					};
					setTimeout(poll, 1500);
				}).catch((e) => {
					setRestartState(null);
					setMsg({ type: "err", text: "重启失败: " + String((e && e.message) || e) });
				});
			};
			const warnRow = (w) => h("div", { style: { fontSize: 12, color: w && w.level === "red" ? "var(--dsw-alias-state-error-primary,#FF453A)" : "#FFD60A", marginTop: 2 } }, (w && w.text) || "");
			const instRow = (p) => h("div", { key: p.name, className: "madazi-settings-row" },
				h("div", { className: "madazi-settings-row-main" },
					h("div", { className: "madazi-settings-row-n" }, p.name),
					h("div", { className: "madazi-settings-row-d" }, "v" + (p.version || "?") + (p.enabled ? " · 已启用" : " · 已停用") + (p.active ? " · " + p.active : ""))
				),
				h("div", { style: { display: "flex", gap: 6, alignItems: "center" } },
					h("button", { className: "madazi-settings-open", onClick: () => doToggle(p.name, !p.enabled) }, p.enabled ? "停用" : "启用"),
					h("button", { className: "madazi-btn-danger", onClick: () => doUninstall(p.name), disabled: !!busyName }, "卸载")
				)
			);
			const resRow = (r) => {
				const pc = prechecks[r.name];
				return h("div", { key: r.name, className: "madazi-settings-row", style: { flexDirection: "column", alignItems: "stretch", gap: 6 } },
					h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 } },
						h("div", { className: "madazi-settings-row-main" },
							h("div", { className: "madazi-settings-row-n" }, r.name),
							h("div", { className: "madazi-settings-row-d" }, ((r.description || "")).slice(0, 80) + (r.version ? " · v" + r.version : ""))
						),
						h("div", { style: { display: "flex", gap: 6, alignItems: "center" } },
							h("button", { className: "madazi-settings-open", onClick: () => doPrecheck(r.name) }, "预检"),
							h("button", { className: "madazi-settings-open", onClick: () => doInstall(r.name), disabled: !!busyName }, busyName === r.name ? "安装中…" : "安装")
						)
					),
					pc ? (pc.loading ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } }, "预检中…")
						: pc.error ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, "预检失败: " + pc.error)
							: h("div", null, [
								h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } }, "latest: " + (pc.latest || "-") + (pc.next ? " · next: " + pc.next : "")),
								(pc.warnings || []).map(warnRow)
							])) : null
				);
			};
			return h("div", { className: "madazi-settings" },
				h("div", { className: "madazi-settings-hd" },
					h("div", null,
						h("div", { className: "madazi-settings-title" }, "插件"),
						h("div", { className: "madazi-settings-sub" }, "DSH 插件市场 · npmmirror · 一键安装（自动回滚）")
					),
					h("button", { className: "madazi-settings-refresh", onClick: loadInstalled }, "刷新")
				),
				msg ? h("div", { style: { fontSize: 12, padding: "6px 8px", marginBottom: 8, borderRadius: 6, background: msg.type === "ok" ? "rgba(52,199,89,.1)" : "rgba(255,69,58,.12)", color: msg.type === "ok" ? "var(--dsw-alias-state-success-primary,#34C759)" : "var(--dsw-alias-state-error-primary,#FF453A)" } }, msg.text) : null,
				h("div", { className: "madazi-settings-list", style: { flexDirection: "column", gap: 8 } },
					h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
						h(Input, { value: q, placeholder: "搜索插件（包名/关键词）…", onChange: (e) => setQ(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") doSearch(); }, style: { flex: 1 } }),
						h(Button, { variant: "primary", size: "sm", onClick: doSearch, disabled: searching }, searching ? "搜索中…" : "搜索")
					),
					results === null ? null
						: results.length === 0 ? h("div", { className: "madazi-pop-d" }, "无匹配结果")
							: results.map(resRow)
				),
				h("div", { className: "madazi-settings-list" },
						h("div", { className: "madazi-settings-row", style: { flexDirection: "column", alignItems: "stretch", gap: 8 } },
						h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 } },
							h("div", { className: "madazi-settings-row-n" }, "已安装"),
							h("button", { className: "madazi-settings-open", onClick: () => setRestartConfirm(true), disabled: !!restartState, style: restartState ? { opacity: 0.6 } : null },
								restartState ? "重启中… (pod 重建)" : "⟳ 重启 dsh-web 生效")
						),
							installed === null ? h("div", { className: "madazi-pop-d" }, "加载中…")
								: installed.length === 0 ? h("div", { className: "madazi-pop-d" }, "暂无已装插件")
									: installed.map(instRow)
						)
					),
				// ★ 重启确认弹窗（复用 madazi-flow-overlay/dialog + members-hd 既有样式，替代原生 confirm）
				restartConfirm ? h("div", { className: "madazi-flow-overlay", onClick: () => setRestartConfirm(false) },
					h("div", { className: "madazi-flow-dialog", onClick: (e) => e.stopPropagation() },
						h("div", { className: "madazi-members-hd" }, "重启 dsh-web"),
						h("div", { style: { padding: "14px 16px", fontSize: 12.5, lineHeight: 1.9, color: "var(--dsw-alias-label-secondary)" } },
							h("div", null, "重启使新装插件进入启动树（运行中的进程缓存旧树，重启后新页面才会加载）。"),
							h("div", { style: { color: "var(--dsw-alias-state-warning-primary,#FF9F0A)" } }, "· 正在运行的 AI 会话会被中断，约 15 秒恢复，历史会话保留"),
							h("div", null, "· 在线用户会短暂看到加载页，连接自动恢复"),
							h("div", { style: { color: "var(--dsw-alias-label-tertiary)" } }, "· 完成后本页将自动刷新以加载新插件")
						),
						h("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", padding: "10px 16px", borderTop: "1px solid var(--dsw-alias-border-l1)" } },
							h("button", { className: "madazi-btn-ghost", onClick: () => setRestartConfirm(false) }, "取消"),
							h("button", { className: "madazi-btn-pri", onClick: doRestart }, "确认重启")
						)
					)
				) : null
			);
			};

		// ─────────────────────────────────────────────────────────────
		// M2 模板市场（doc/2026-08-23-模板市场设计.md）：浏览/搜索/分类/排序
		// + 详情（README/版本）+ 一键安装为新项目 + 评分。
		// 数据层直连 server API（浏览器同源 cookie 鉴权，与插件市场同模式）：
		//   GET  /api/market/templates?search&category&sort&mine&limit
		//   GET  /api/market/templates/:slug          → 详情（versions/readme/my_rating）
		//   POST /api/market/templates/:slug/install  {name, version?} → project
		//   POST /api/market/templates/:slug/rate     {score: 1-5}
		// ─────────────────────────────────────────────────────────────
		const MKT_SORTS = [
			{ id: "popular", label: "最多下载" },
			{ id: "newest", label: "最新发布" },
			{ id: "rating", label: "最高评分" },
		];
		const mktFetch = (path, opts) => madaziFetch(path, opts).then((d) => {
			if (d && d.error) throw new Error(typeof d.error === "object" ? JSON.stringify(d.error) : d.error);
			return d;
		});
		const mktBadge = (t) => t.source_type === "official" ? h("span", { className: "madazi-mkt-badge official" }, "官方")
			: t.status === "pending" ? h("span", { className: "madazi-mkt-badge pending" }, "审核中")
				: t.visibility === "private" ? h("span", { className: "madazi-mkt-badge private" }, "私有")
					: h("span", { className: "madazi-mkt-badge community" }, "社区");
		const mktDate = (v) => { try { return new Date(v).toLocaleDateString("zh-CN"); } catch { return ""; } };
		// patch 版本号递增（详情页「发布新版本」默认值）
		const bumpPatch = (v) => {
			const m = String(v || "").match(/^(\d+)\.(\d+)\.(\d+)/);
			return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : "1.0.0";
		};

		// ─────────────────────────────────────────────────────────────
		// M3 发布为模板向导：项目 → 密钥扫描 → zip 打包 → 上架。
		//   POST /api/market/templates/publish
		//   { projectId, name, description, category, tags[], visibility, version, changelog }
		// ★ 原生 fetch（非 madaziFetch）：422 响应体需带 findings 全量字段逐条展示
		// prefill（详情页「发布新版本」）：{ projectId, name, description, category, tags, visibility, nextVersion }
		// ─────────────────────────────────────────────────────────────
		const PublishTemplateModal = ({ project, prefill, onClose }) => {
			const projName = (project && (project.name || project.title)) || "";
			const [name, setName] = useState((prefill && prefill.name) || projName || "");
			const [desc, setDesc] = useState((prefill && prefill.description) || (project && project.description) || "");
			const [category, setCategory] = useState((prefill && prefill.category) || "fullstack");
			const [tagsStr, setTagsStr] = useState(prefill && Array.isArray(prefill.tags) ? prefill.tags.join(", ") : "");
			const [visibility, setVisibility] = useState((prefill && prefill.visibility) || "private");
			const [version, setVersion] = useState((prefill && prefill.nextVersion) || "1.0.0");
			const [changelog, setChangelog] = useState("");
			const [busy, setBusy] = useState(false);
			const [err, setErr] = useState(null);
			const [findings, setFindings] = useState(null);
			const [truncated, setTruncated] = useState(false);
			const [okResult, setOkResult] = useState(null);
			const projectId = (prefill && prefill.projectId) || (project && project.id);

			const submit = async () => {
				if (busy) return;
				if (!name.trim()) { setErr("模板名称不能为空"); return; }
				if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version.trim())) { setErr("版本号需为 semver 格式（如 1.0.0）"); return; }
				setBusy(true); setErr(null); setFindings(null); setTruncated(false); setOkResult(null);
				try {
					const resp = await fetch("/api/market/templates/publish", {
						method: "POST",
						credentials: "same-origin",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							projectId,
							name: name.trim(),
							description: desc.trim(),
							category,
							tags: tagsStr.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
							visibility,
							version: version.trim(),
							changelog: changelog.trim(),
						}),
					});
					const j = await resp.json().catch(() => ({}));
					if (!resp.ok) {
					// ★ 409 版本冲突：自动递增 patch 号，用户直接再点发布即可
					if (resp.status === 409 && j.latest_version) {
						const next = bumpPatch(j.latest_version);
						setVersion(next);
						setErr("版本已存在，已自动递增为 " + next + "，请重新点击发布");
					} else {
						setErr(j.error || ("HTTP " + resp.status));
					}
					if (Array.isArray(j.findings)) setFindings(j.findings);
					if (j.truncated) setTruncated(true);
					return;
				}
					setOkResult(j);
				} catch (e) {
					setErr(String((e && e.message) || e));
				} finally {
					setBusy(false);
				}
			};

			// ── 发布成功态 ──
			if (okResult) {
				const t = okResult.template || {}, v = okResult.version || {};
				const warns = Array.isArray(okResult.scanWarnings) ? okResult.scanWarnings : [];
				return h(Modal, {
					open: true, onClose, title: "发布成功", closeLabel: "关闭",
					footer: h("div", { style: { display: "flex", gap: 8 } },
						h(Button, { variant: "ghost", size: "md", onClick: onClose }, "完成")),
					children: h("div", { className: "madazi-mkt-ok" },
						h("div", { className: "t" }, t.visibility === "public" ? "已提交，等待审核" : "已上架（私有，仅自己可见）"),
						h("div", null, "标识：", h("b", null, t.slug), " · 版本 v" + v.version),
						h("div", { style: { color: "var(--dsw-alias-label-secondary)" } },
							(v.file_count || 0) + " 个文件 · " + ((v.pkg_size || 0) / 1024 / 1024).toFixed(2) + " MB"
							+ (t.visibility === "public" ? " · 审核通过后全员可见" : " · 可在市场「我的模板」中查看")),
						warns.length > 0 ? h("div", { style: {
							marginTop: 12, padding: "10px 12px", borderRadius: 8,
							background: "rgba(255, 180, 0, 0.12)",
							border: "1px solid rgba(255, 180, 0, 0.4)",
							color: "var(--dsw-alias-state-warning-primary,#FF9F0A)", fontSize: 13, lineHeight: 1.6,
						} },
							h("div", { style: { fontWeight: 600 } }, "已发布，但检出 " + warns.length + " 处疑似密钥内容（未阻断，模板内仍保留，请注意清理）："),
							h("ul", { style: { margin: "6px 0 0", paddingLeft: 18 } },
								warns.slice(0, 20).map((w, i) => h("li", { key: i },
									(w.file || "") + (w.line ? ":" + w.line : "") + " · " + (w.label || "") + "（" + (w.match || "") + "）"))),
							okResult.scanTruncated ? h("div", { style: { marginTop: 4, opacity: 0.8 } }, "…更多命中已省略") : null,
						) : null,
					),
				});
			}

			return h(Modal, {
				open: true, onClose, title: (prefill ? "发布新版本" : "发布为模板") + (projName ? " · " + projName : ""), closeLabel: "关闭",
				footer: h("div", { style: { display: "flex", gap: 8 } },
					h(Button, { variant: "ghost", size: "md", onClick: onClose, disabled: busy }, "取消"),
					h(Button, { variant: "primary", size: "md", onClick: submit, disabled: busy }, busy ? "发布中…" : "发布")),
				children: h("div", { className: "madazi-pub-form" },
					h("div", null,
						h("label", null, "模板名称"),
						h("input", { className: "madazi-inp", value: name, onChange: (e) => setName(e.target.value), placeholder: "市场卡片显示的名称", disabled: busy })),
					h("div", null,
						h("label", null, "描述"),
						h("textarea", { className: "madazi-inp", value: desc, onChange: (e) => setDesc(e.target.value), placeholder: "一句话介绍这个模板（可选）", rows: 2, disabled: busy })),
					h("div", { style: { display: "flex", gap: 8 } },
						h("div", { style: { flex: 1 } },
							h("label", null, "分类"),
							h("select", { className: "madazi-sel", value: category, onChange: (e) => setCategory(e.target.value), disabled: busy },
								h("option", { value: "fullstack" }, "全栈 fullstack"),
								h("option", { value: "miniapp" }, "小程序 miniapp"),
								h("option", { value: "admin" }, "管理后台 admin"),
								h("option", { value: "library" }, "组件库 library"))),
						h("div", { style: { flex: 1 } },
							h("label", null, "版本号（semver）"),
							h("input", { className: "madazi-inp", value: version, onChange: (e) => setVersion(e.target.value), placeholder: "1.0.0", disabled: busy }))),
					h("div", null,
						h("label", null, "标签（逗号分隔，最多 10 个）"),
						h("input", { className: "madazi-inp", value: tagsStr, onChange: (e) => setTagsStr(e.target.value), placeholder: "例如：Vue, SpringBoot, 审批流", disabled: busy })),
					h("div", null,
						h("label", null, "可见性"),
						h("div", { className: "madazi-mkt-chips", style: { marginTop: 4 } },
							h("button", { type: "button", className: "madazi-mkt-chip" + (visibility === "private" ? " on" : ""), onClick: () => setVisibility("private"), disabled: busy }, "私有 · 发布即上架"),
							h("button", { type: "button", className: "madazi-mkt-chip" + (visibility === "public" ? " on" : ""), onClick: () => setVisibility("public"), disabled: busy }, "公开 · 需审核")),
						h("div", { className: "madazi-pub-hint" }, "发布前自动执行密钥扫描（证书 / AK-SK / API Key 等命中即拒绝）；README.md 与源码一并打包，安装时还原为新项目。")),
					h("div", null,
						h("label", null, "更新说明（changelog，可选）"),
						h("textarea", { className: "madazi-inp", value: changelog, onChange: (e) => setChangelog(e.target.value), placeholder: "本版本改了什么…", rows: 2, disabled: busy })),
					err ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, err) : null,
					findings ? h("div", { className: "madazi-mkt-findings" },
						findings.map((f, i) => h("div", { key: i, className: "madazi-mkt-finding" },
							h("div", { className: "fl" }, (f.label || f.rule || "命中") + (f.line ? " · 第 " + f.line + " 行" : "")),
							h("div", { className: "ff" }, f.file || ""),
							f.match ? h("div", { className: "ff", style: { fontFamily: "ui-monospace,Menlo,monospace" } }, f.match) : null)),
						truncated ? h("div", { className: "madazi-pub-hint" }, "命中过多，仅展示前若干条…") : null) : null,
			),
		});
	};

	/** ★ 常驻发布向导宿主：侧栏官方菜单（纯 DOM 注入）触发的「发布为模板」走独立
	 *  React root（react-dom/client createRoot），不依赖 ProjectsEntry 挂载——
	 *  ProjectsEntry 仅在「添加项目」弹窗打开时存在，此前事件派发后无人监听。
	 *  挂载点：apply() 里（所有 const 初始化完成后），login 插件同模式。 */
	const PublishHost = () => {
		const [proj, setProj] = useState(null);
		useEffect(() => {
			const onPub = (e) => {
				if (e && e.detail && e.detail.id) setProj(e.detail);
			};
			window.addEventListener("madazi-publish-template", onPub);
			return () => window.removeEventListener("madazi-publish-template", onPub);
		}, []);
		return proj ? h(PublishTemplateModal, { project: proj, onClose: () => setProj(null) }) : null;
	};

		/** 市场浏览器（可复用）：settings 分节与「添加项目」目录流共用。
		 *  onInstalled(project)：安装成功回调（宿主决定打开工作区/关闭弹窗）。 */
		const TemplateMarketBrowser = ({ onInstalled }) => {
			const [list, setList] = useState(null);
			const [q, setQ] = useState("");
			const [category, setCategory] = useState("");
			const [sort, setSort] = useState("popular");
			const [mine, setMine] = useState(false);
			const [err, setErr] = useState(null);
			const [loading, setLoading] = useState(false);
			const [me, setMe] = useState(null); // M3：作者判定（发布新版本/下架仅作者+admin）
			const [pubPrefill, setPubPrefill] = useState(null); // M3：详情页「发布新版本」向导
			// 详情态
			const [detailSlug, setDetailSlug] = useState(null);
			const [detail, setDetail] = useState(null);
			const [detailErr, setDetailErr] = useState(null);
			// 安装态
			const [instName, setInstName] = useState("");
			const [instVer, setInstVer] = useState(null);
			const [instBusy, setInstBusy] = useState(false);
			const [instErr, setInstErr] = useState(null);
			// 评分态
			const [rateScore, setRateScore] = useState(0);
			const [rateMsg, setRateMsg] = useState(null);

			const loadList = (over = {}) => {
				setLoading(true); setErr(null);
				const p = Object.assign({ search: q.trim(), category, sort, mine }, over);
				const qs = new URLSearchParams();
				if (p.search) qs.set("search", p.search);
				if (p.category) qs.set("category", p.category);
				if (p.sort) qs.set("sort", p.sort);
				if (p.mine) qs.set("mine", "1");
				qs.set("limit", "60");
				mktFetch("/market/templates?" + qs.toString()).then((v) => {
					setList(Array.isArray(v) ? v : []);
				}).catch((e) => setErr(String((e && e.message) || e))).finally(() => setLoading(false));
			};
			useEffect(() => { loadList(); }, []);
			// M3：当前用户（作者判定）
			useEffect(() => {
				mktFetch("/auth/me").then((v) => {
					const u = v && v.user ? v.user : v;
					if (u && u.id) setMe(u);
				}).catch(() => {});
			}, []);
			// M3：作者/管理员可下架（official 不可）
			const doArchive = () => {
				if (!detailSlug) return;
				if (!window.confirm("确认下架该模板？已安装的项目不受影响。")) return;
				mktFetch("/market/templates/" + encodeURIComponent(detailSlug) + "/archive", { method: "POST" }).then(() => {
					setDetailSlug(null); setDetail(null); loadList();
				}).catch((e) => setDetailErr(String((e && e.message) || e)));
			};
			const openDetail = (slug) => {
				setDetailSlug(slug); setDetail(null); setDetailErr(null);
				setInstErr(null); setRateMsg(null); setInstVer(null);
				mktFetch("/market/templates/" + encodeURIComponent(slug)).then((d) => {
					setDetail(d);
					setInstName(d.name || "");
					setRateScore(d.my_rating ? d.my_rating.score : 0);
				}).catch((e) => setDetailErr(String((e && e.message) || e)));
			};
			const doRate = (score) => {
				if (!detailSlug) return;
				setRateScore(score);
				mktFetch("/market/templates/" + encodeURIComponent(detailSlug) + "/rate", {
					method: "POST", body: JSON.stringify({ score }),
				}).then(() => {
					setRateMsg("感谢评分！");
					// 刷新详情（rating_avg / rating_count / my_rating 回显）
					mktFetch("/market/templates/" + encodeURIComponent(detailSlug)).then((d) => setDetail(d)).catch(() => {});
				}).catch((e) => setRateMsg("评分失败: " + String((e && e.message) || e)));
			};
			const doInstall = () => {
				if (instBusy) return;
				if (!instName.trim()) { setInstErr("项目名称不能为空"); return; }
				setInstBusy(true); setInstErr(null);
				const body = { name: instName.trim() };
				if (instVer) body.version = instVer;
				mktFetch("/market/templates/" + encodeURIComponent(detailSlug) + "/install", {
					method: "POST", body: JSON.stringify(body),
				}).then((proj) => {
					if (onInstalled) return Promise.resolve(onInstalled(proj));
				}).catch((e) => setInstErr("安装失败: " + String((e && e.message) || e)))
					.finally(() => setInstBusy(false));
			};

			// ── 详情视图 ──
			if (detailSlug) {
				const selVer = instVer || (detail && detail.versions && detail.versions[0] && detail.versions[0].version);
				// M3：作者（或 admin）可管理；官方模板不可
				const isOwner = detail && me && (detail.author_id === me.id || window.__madaziIsAdmin);
				const canManage = isOwner && detail.source_type !== "official" && detail.status !== "archived";
				return h("div", { className: "madazi-settings" },
					h("div", { className: "madazi-settings-hd" },
						h("div", null,
							h("div", { className: "madazi-settings-title" }, detail ? detail.name : "模板详情"),
							detail ? h("div", { className: "madazi-settings-sub" },
								detail.slug + " · ↓ " + (detail.download_count || 0)
								+ " · ★ " + (detail.rating_avg ? Number(detail.rating_avg).toFixed(1) : "-") + (detail.rating_count ? " (" + detail.rating_count + ")" : "")
								+ " · " + mktDate(detail.updated_at || detail.created_at)
							) : null
						),
						h("div", { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" } },
							canManage && detail.origin_project_id ? h(Button, {
								variant: "ghost", size: "sm", title: "从来源项目重新打包发布新版本",
								onClick: () => setPubPrefill({
									projectId: detail.origin_project_id,
									name: detail.name,
									description: detail.description,
									category: detail.category,
									tags: detail.tags,
									visibility: detail.visibility,
									nextVersion: bumpPatch(detail.latest_version || (detail.versions && detail.versions[0] && detail.versions[0].version)),
								}),
							}, "发布新版本") : null,
							canManage ? h(Button, { variant: "ghost", size: "sm", onClick: doArchive, title: "下架后市场不再展示" }, "下架") : null,
							h(Button, { variant: "ghost", size: "sm", onClick: () => { setDetailSlug(null); setDetail(null); loadList(); } }, "返回市场"))
					),
					detailErr ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, detailErr)
						: !detail ? h("div", { className: "madazi-pop-d" }, "加载中…")
							: h("div", { style: { display: "flex", flexDirection: "column", gap: 10 } },
								detail.readme ? h("div", { className: "madazi-mkt-readme" }, detail.readme) : null,
								h("div", null,
									h("div", { className: "madazi-settings-row-n" }, "版本"),
									h("div", { className: "madazi-mkt-vers" },
										(detail.versions || []).length === 0 ? h("div", { className: "madazi-pop-d" }, "暂无可用版本")
											: (detail.versions || []).map((v) => h("button", {
												key: v.id, type: "button",
												className: "madazi-mkt-ver" + (selVer === v.version ? " on" : ""),
												onClick: () => setInstVer(v.version),
												title: v.status === "rejected" && v.review_note ? "已驳回：" + v.review_note : "选择此版本安装",
											},
												h("span", { className: "v" }, "v" + v.version
													+ (v.status === "pending" ? " · 审核中" : "")
													+ (v.status === "rejected" ? " · 已驳回" : "")),
												h("span", { className: "c" }, v.changelog || mktDate(v.created_at))
											)))
								),
								h("div", null,
									h("div", { className: "madazi-settings-row-n" }, "评分"),
									h("div", { className: "madazi-mkt-stars" },
										[1, 2, 3, 4, 5].map((s) => h("span", {
											key: s, className: "madazi-mkt-star" + (s <= rateScore ? " on" : ""),
											onClick: () => doRate(s), title: s + " 星",
										}, "★"))),
									rateMsg ? h("div", { style: { fontSize: 11, marginTop: 4, color: rateMsg.indexOf("失败") === -1 ? "var(--dsw-alias-state-success-primary,#34C759)" : "var(--dsw-alias-state-error-primary,#FF453A)" } }, rateMsg) : null
								),
								h("div", null,
									h("div", { className: "madazi-settings-row-n" }, "安装为新项目"),
									h("div", { className: "madazi-mkt-install-row" },
										h(Input, { value: instName, placeholder: "新项目名称…", onChange: (e) => setInstName(e.target.value), style: { flex: 1 } }),
										h(Button, { variant: "primary", size: "md", disabled: instBusy, onClick: doInstall }, instBusy ? "安装中…" : "安装")
									),
									instErr ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)", marginTop: 6 } }, instErr) : null
								)
							),
					// M3：发布新版本向导（发布成功后刷新详情 + 列表）
					pubPrefill ? h(PublishTemplateModal, {
						prefill: pubPrefill,
						onClose: () => { setPubPrefill(null); openDetail(detailSlug); loadList(); },
					}) : null
				);
			}

			// ── 列表视图 ──
			const cats = [];
			for (const t of list || []) if (t.category && cats.indexOf(t.category) === -1) cats.push(t.category);
			const cardRow = (t) => h("button", { key: t.id, type: "button", className: "madazi-mkt-card", onClick: () => openDetail(t.slug) },
				h("div", { className: "madazi-mkt-card-hd" },
					h("span", { className: "madazi-mkt-icon" }, (t.name || "?").slice(0, 2)),
					h("span", { className: "madazi-mkt-name" }, t.name || t.slug),
					mktBadge(t)
				),
				t.description ? h("div", { className: "madazi-mkt-desc" }, t.description) : null,
				Array.isArray(t.tags) && t.tags.length ? h("div", { className: "madazi-mkt-tags" }, t.tags.slice(0, 6).map((tag) => h("span", { key: tag }, tag))) : null,
				h("div", { className: "madazi-mkt-meta" },
					h("span", null, "↓ " + (t.download_count || 0)),
					h("span", null, "★ " + (t.rating_avg ? Number(t.rating_avg).toFixed(1) : "-") + (t.rating_count ? " (" + t.rating_count + ")" : "")),
					h("span", null, mktDate(t.updated_at || t.created_at))
				)
			);
			return h("div", null,
				h("div", { className: "madazi-mkt-toolbar" },
					h(Input, {
						value: q, placeholder: "搜索模板名称/描述/标签…",
						onChange: (e) => setQ(e.target.value),
						onKeyDown: (e) => { if (e.key === "Enter") loadList(); },
						style: { flex: 1, minWidth: 160 },
					}),
					h(Button, { variant: "ghost", size: "sm", onClick: () => loadList(), disabled: loading }, loading ? "加载中…" : "搜索"),
					h("select", {
						className: "madazi-mkt-sort", value: sort, title: "排序",
						onChange: (e) => { const v = e.target.value; setSort(v); loadList({ sort: v }); },
					}, MKT_SORTS.map((s) => h("option", { key: s.id, value: s.id }, s.label)))
				),
				h("div", { className: "madazi-mkt-chips" },
					h("button", { type: "button", className: "madazi-mkt-chip" + (category === "" && !mine ? " on" : ""), onClick: () => { setCategory(""); setMine(false); loadList({ category: "", mine: false }); } }, "全部"),
					cats.map((c) => h("button", { key: c, type: "button", className: "madazi-mkt-chip" + (category === c && !mine ? " on" : ""), onClick: () => { setCategory(c); setMine(false); loadList({ category: c, mine: false }); } }, c)),
					h("button", { type: "button", className: "madazi-mkt-chip" + (mine ? " on" : ""), onClick: () => { setMine(true); loadList({ mine: true }); } }, "我的模板"),
					h("span", { style: { flex: 1 } }),
					h("button", { type: "button", className: "madazi-mkt-chip", onClick: () => loadList(), title: "重新加载" }, "刷新")
				),
				h("div", { className: "madazi-mkt-list" },
					err ? h("div", { style: { padding: 12, fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, err)
						: list === null ? h("div", { className: "madazi-pop-d" }, "加载中…")
							: list.length === 0 ? h("div", { className: "madazi-pop-d" }, mine ? "你还没有发布过模板" : "暂无模板")
								: list.map(cardRow)
				)
			);
		};

		/** M2 模板市场 settings 分节（所有登录用户可浏览/安装/评分；发布入口在项目工作区） */
		const TemplateMarketSection = ({ close, onOpenProject }) => {
			return h("div", { className: "madazi-settings" },
				h("div", { className: "madazi-settings-hd" },
					h("div", null,
						h("div", { className: "madazi-settings-title" }, "模板市场"),
						h("div", { className: "madazi-settings-sub" }, "官方与社区项目模板 · 一键安装为新项目")
					)
				),
				h(TemplateMarketBrowser, {
					onInstalled: async (proj) => {
						if (onOpenProject) await onOpenProject(proj);
						if (close) close();
					},
				})
			);
		};
		// ★ 导出必须放在 const 定义之后（TDZ：exports 段在前会 Cannot access before initialization）
		exports.TemplateMarketBrowser = TemplateMarketBrowser;
		exports.TemplateMarketSection = TemplateMarketSection;
