		// M4 技能市场（SkillMarketSection）：浏览/搜索/安装平台共享技能。
		// 数据层直连 server API（浏览器同源 cookie 鉴权，与成员管理浮层同模式）：
		//   GET  /api/skills           市场列表（is_public）
		//   GET  /api/skills/:id       详情（含 prompt 正文）
		//   POST /api/skills/:id/install/:projectId   安装到项目（写 .agents/skills/<slug>.md）
		//   POST /api/skills           发布技能
		//   GET  /api/projects         项目列表（安装目标）
		// 官方 dsh-skill-filesystem 自动发现 .agents/skills/*.md，安装即生效；DSH 技能名只认 kebab-case（/slug 触发）。
		const SkillMarketBrowser = ({ onInstalled, t }) => {
			const [list, setList] = useState(null);
			const [err, setErr] = useState(null);
			const [q, setQ] = useState("");
			const [category, setCategory] = useState("");
			const [detailId, setDetailId] = useState(null);
			const [detail, setDetail] = useState(null);
			const [detailErr, setDetailErr] = useState(null);
			const [projects, setProjects] = useState(null);
			const [instProj, setInstProj] = useState("");
			const [instBusy, setInstBusy] = useState(false);
			const [instMsg, setInstMsg] = useState(null);
			// 发布表单
			const [pubOpen, setPubOpen] = useState(false);
			const [pub, setPub] = useState({ name: "", slug: "", description: "", icon: "sparkles", color: "#5E6AD2", category: "general", prompt: "", is_builtin: false });
			const [pubBusy, setPubBusy] = useState(false);
			const [pubMsg, setPubMsg] = useState(null);
			const [isAdmin, setIsAdmin] = useState(false);

			const sapi = (path, opts) => madaziFetch(path, opts).then((d) => {
				if (d && d.error) throw new Error(typeof d.error === "object" ? JSON.stringify(d.error) : d.error);
				return d;
			});

			const loadList = (over = {}) => {
				setErr(null);
				const params = [];
				if (over.q !== undefined ? over.q : q) params.push("q=" + encodeURIComponent(over.q !== undefined ? over.q : q));
				if (over.category !== undefined ? over.category : category) params.push("category=" + encodeURIComponent(over.category !== undefined ? over.category : category));
				const qs = params.length ? "?" + params.join("&") : "";
				sapi("/skills" + qs).then((v) => {
					let arr = Array.isArray(v) ? v : [];
					// ★ 后端列表接口尚未实现 q/category 过滤，前端兜底过滤
					const kw = (over.q !== undefined ? over.q : q || "").toLowerCase();
					const cat = (over.category !== undefined ? over.category : category || "");
					if (kw || cat) arr = arr.filter((s) => {
						const okCat = !cat || (s.category || "") === cat;
						const okKw = !kw || ((s.name || "") + " " + (s.description || "")).toLowerCase().indexOf(kw) !== -1;
						return okCat && okKw;
					});
					setList(arr);
				}).catch((e) => setErr(String((e && e.message) || e)));
			};
			useEffect(() => { loadList(); }, []);
			// 身份判定：是否管理员（决定发布表单是否显示"官方内置"开关）
			useEffect(() => {
				madaziFetch("/auth/me").then((d) => {
					const me = d && (d.user || d);
					setIsAdmin(!!(me && (me.role === "admin" || me.isAdmin)));
				}).catch(() => {});
			}, []);

			const loadProjects = () => {
				if (projects !== null) return;
				sapi("/projects").then((v) => setProjects(Array.isArray(v) ? v : [])).catch(() => setProjects([]));
			};

			const openDetail = (id) => {
				// ★ 安装默认当前项目（_currentProjectId 经 _madaziCtx 反查；无则回退手选）
				const curProj = (typeof _currentProjectId === "function" && _madaziCtx) ? (_currentProjectId(_madaziCtx) || "") : "";
				setDetailId(id); setDetail(null); setDetailErr(null); setInstMsg(null); setInstProj(curProj);
				loadProjects();
				sapi("/skills/" + id).then((v) => setDetail(v)).catch((e) => setDetailErr(String((e && e.message) || e)));
			};

			const doInstall = () => {
				if (!instProj || instBusy || !detailId) return;
				setInstBusy(true); setInstMsg(null);
				sapi("/skills/" + detailId + "/install/" + instProj, { method: "POST" }).then((v) => {
					if (v && v.ok === false) setInstMsg({ type: "err", text: "安装失败: " + (v.error || "") });
					else {
						const slug = (detail && detail.slug) || (detail && detail.name || "");
						setInstMsg({ type: "ok", text: "已安装「" + (detail && detail.name || "") + "」——对话中输入 /" + slug + " 可触发" });
						loadList();
					}
				}).catch((e) => setInstMsg({ type: "err", text: "安装失败: " + String((e && e.message) || e) })).finally(() => setInstBusy(false));
			};

			const doPublish = () => {
				if (pubBusy) return;
				if (!pub.name.trim() || !pub.prompt.trim()) { setPubMsg({ type: "err", text: "名称和技能内容不能为空" }); return; }
				setPubBusy(true); setPubMsg(null);
				sapi("/skills", { method: "POST", body: JSON.stringify(pub) }).then((v) => {
					if (v && v.error) setPubMsg({ type: "err", text: "发布失败: " + v.error });
					else {
						setPubMsg({ type: "ok", text: "已发布「" + v.name + "」" + (v.is_builtin ? "（官方内置，全项目可用）" : "，可在市场安装") });
						setPubOpen(false);
						setPub({ name: "", slug: "", description: "", icon: "sparkles", color: "#5E6AD2", category: "general", prompt: "", is_builtin: false });
						loadList();
					}
				}).catch((e) => setPubMsg({ type: "err", text: "发布失败: " + String((e && e.message) || e) })).finally(() => setPubBusy(false));
			};

			// ── 详情视图 ──
			if (detailId !== null) {
				return h("div", null,
					h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } },
						h("div", { className: "madazi-settings-title" }, "技能详情"),
						h(Button, { variant: "ghost", size: "sm", onClick: () => { setDetailId(null); setDetail(null); } }, "返回市场")
					),
					detailErr ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, detailErr)
						: !detail ? h("div", { className: "madazi-pop-d" }, "加载中…")
							: h("div", { style: { display: "flex", flexDirection: "column", gap: 12 } },
								h("div", { className: "madazi-settings-row" },
									h("div", { className: "madazi-settings-row-main" },
										h("div", { className: "madazi-settings-row-n" }, detail.name || detail.id),
										h("div", { className: "madazi-settings-row-d" }, (detail.description || "无描述") + " · 作者 " + (detail.author_name || "?") + " · 安装 " + (detail.install_count || 0)),
									)
								),
								detail.prompt ? h("div", { className: "madazi-mkt-readme" }, detail.prompt) : null,
								detail.is_builtin
									? h("div", { className: "madazi-mkt-builtin-tip" },
										h("div", null, "内置技能：已在所有项目全局生效，无需安装"),
										h("div", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary)", marginTop: 4 } }, "在任意项目对话中输入 /" + (detail.slug || "") + " 即可触发")
									)
									: h("div", null,
										h("div", { className: "madazi-settings-row-n" }, "安装到项目"),
										h("div", { className: "madazi-mkt-install-row" },
											h("select", {
												className: "madazi-sel", value: instProj, style: { flex: 1 },
												onChange: (e) => setInstProj(e.target.value),
												disabled: projects === null,
											},
												h("option", { value: "" }, projects === null ? "加载项目…" : "选择项目…"),
												(projects || []).map((p) => h("option", { key: p.id, value: p.id }, p.name || p.id.slice(0, 8)))
											),
											h(Button, { variant: "primary", size: "md", disabled: instBusy || !instProj, onClick: doInstall }, instBusy ? "安装中…" : "安装")
										),
										instMsg ? h("div", { style: { fontSize: 12, marginTop: 6, color: instMsg.type === "ok" ? "var(--dsw-alias-state-success-primary,#34C759)" : "var(--dsw-alias-state-error-primary,#FF453A)" } }, instMsg.text) : null
									)
							)
				);
			}

			// ── 发布表单 ──
			if (pubOpen) {
				const field = (label, val, set, placeholder, textarea) =>
					h("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
						h("label", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary)" } }, label),
						textarea
							? h("textarea", { className: "madazi-inp", rows: 8, value: val, placeholder, onChange: (e) => set(e.target.value), style: { fontFamily: "ui-monospace,Menlo,monospace", fontSize: 12 } })
							: h("input", { className: "madazi-inp", value: val, placeholder, onChange: (e) => set(e.target.value) })
					);
				return h("div", null,
					h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } },
						h("div", { className: "madazi-settings-title" }, "发布技能"),
						h(Button, { variant: "ghost", size: "sm", onClick: () => { setPubOpen(false); setPubMsg(null); } }, "取消")
					),
					h("div", { className: "madazi-pub-form" },
						field("名称 *", pub.name, (v) => setPub({ ...pub, name: v }), "如：代码审查助手"),
						field("英文标识（对话中 /xxx 触发，kebab-case 小写字母数字连字符；可留空）", pub.slug, (v) => setPub({ ...pub, slug: v }), "如：code-review"),
						field("描述", pub.description, (v) => setPub({ ...pub, description: v }), "一句话说明这个技能的用途"),
						h("div", { style: { display: "flex", gap: 8 } },
							field("分类", pub.category, (v) => setPub({ ...pub, category: v }), "如：code-review / frontend / test"),
						),
						isAdmin ? h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
							h("input", { type: "checkbox", id: "madazi-pub-builtin", checked: !!pub.is_builtin, onChange: (e) => setPub({ ...pub, is_builtin: e.target.checked }) }),
							h("label", { htmlFor: "madazi-pub-builtin", style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } }, "发布为官方内置（所有项目自动可用，无需安装）")
						) : null,
						field("技能内容 *（markdown，发给 AI 的指令）", pub.prompt, (v) => setPub({ ...pub, prompt: v }), "## 角色\n…\n\n## 任务\n…", true),
						pubMsg ? h("div", { style: { fontSize: 12, color: pubMsg.type === "ok" ? "var(--dsw-alias-state-success-primary,#34C759)" : "var(--dsw-alias-state-error-primary,#FF453A)" } }, pubMsg.text) : null,
						h(Button, { variant: "primary", size: "md", disabled: pubBusy, onClick: doPublish }, pubBusy ? "发布中…" : "发布")
					)
				);
			}

			// ── 列表视图 ──
			const cats = [];
			for (const s of list || []) if (s.category && cats.indexOf(s.category) === -1) cats.push(s.category);
			const cardRow = (s) => h("button", { key: s.id, type: "button", className: "madazi-mkt-card", onClick: () => openDetail(s.id) },
				h("div", { className: "madazi-mkt-card-hd" },
					h("span", { className: "madazi-mkt-icon", style: s.color ? { background: (s.color || "#5E6AD2") + "22", color: s.color } : undefined }, (s.name || "?").slice(0, 2)),
					h("span", { className: "madazi-mkt-name" }, s.name || s.id),
					s.is_builtin ? h("span", { className: "madazi-mkt-badge builtin" }, "内置") : null,
					h("span", { className: "madazi-mkt-badge official" }, s.category || "general")
				),
				s.description ? h("div", { className: "madazi-mkt-desc" }, s.description) : null,
				h("div", { className: "madazi-mkt-meta" },
					h("span", null, "↓ " + (s.install_count || 0)),
					h("span", null, "作者 " + (s.author_name || "?"))
				)
			);
			return h("div", null,
				h("div", { className: "madazi-mkt-toolbar" },
					h(Input, {
						value: q, placeholder: "搜索技能名称/描述…",
						onChange: (e) => setQ(e.target.value),
						onKeyDown: (e) => { if (e.key === "Enter") loadList(); },
						style: { flex: 1, minWidth: 160 },
					}),
					h(Button, { variant: "ghost", size: "sm", onClick: () => loadList(), disabled: list === null }, "搜索"),
					h(Button, { variant: "ghost", size: "sm", onClick: () => { setPubOpen(true); setPubMsg(null); } }, "发布技能")
				),
				h("div", { className: "madazi-mkt-chips" },
					h("button", { type: "button", className: "madazi-mkt-chip" + (category === "" ? " on" : ""), onClick: () => { setCategory(""); loadList({ category: "" }); } }, "全部"),
					cats.map((c) => h("button", { key: c, type: "button", className: "madazi-mkt-chip" + (category === c ? " on" : ""), onClick: () => { setCategory(c); loadList({ category: c }); } }, c)),
					h("span", { style: { flex: 1 } }),
					h("button", { type: "button", className: "madazi-mkt-chip", onClick: () => loadList(), title: "重新加载" }, "刷新")
				),
				h("div", { className: "madazi-mkt-list" },
					err ? h("div", { style: { padding: 12, fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, err)
						: list === null ? h("div", { className: "madazi-pop-d" }, "加载中…")
							: list.length === 0 ? h("div", { className: "madazi-pop-d" }, "暂无技能，点右上角「发布技能」分享第一个吧")
								: list.map(cardRow)
				)
			);
		};

		/** M4 技能市场 settings 分节（所有登录用户可见） */
		const SkillMarketSection = ({ close, onOpenProject }) => {
			return h("div", { className: "madazi-settings" },
				h("div", { className: "madazi-settings-hd" },
					h("div", null,
						h("div", { className: "madazi-settings-title" }, "技能市场"),
						h("div", { className: "madazi-settings-sub" }, "内置技能全项目自动可用 · 团队技能安装到项目后对话中直接触发")
					)
				),
				h(SkillMarketBrowser, { onInstalled: onOpenProject })
			);
		};

		exports.SkillMarketSection = SkillMarketSection;
