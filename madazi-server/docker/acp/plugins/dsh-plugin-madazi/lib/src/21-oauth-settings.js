		/** OAuth 三方登录配置（仅管理员，2026-08-28）
		 * GET/PUT /admin/oauth：settings 表 oauth_<name> JSON，secret 加密存储 + GET 脱敏。
		 * Secret 留空 = 不修改（后端保留旧值）；保存后 10s 内生效（settings 缓存 TTL）。
		 * 依赖拼接作用域共享的 madaziFetch / h / useState / useEffect。 */
		const OauthSettingsSection = () => {
			const [cfg, setCfg] = useState(null);      // GET 返回（脱敏：无 secret 明文）
			const [secrets, setSecrets] = useState({}); // 独立管理 Secret 输入框
			const [busy, setBusy] = useState(false);
			const [msg, setMsg] = useState(null);
			const [err, setErr] = useState(null);
			const load = () => {
				setErr(null);
				madaziFetch("/admin/oauth").then((v) => {
					if (v && v.error) { setErr(v.error); return; }
					setCfg(v || {});
				}).catch((e) => setErr(String((e && e.message) || e)));
			};
			useEffect(() => { load(); }, []);
			const setOf = (p, k, val) => setCfg((prev) => {
				const next = { ...(prev || {}) };
				next[p] = { ...(next[p] || {}), [k]: val };
				return next;
			});
			const setSecret = (p, val) => setSecrets((prev) => ({ ...prev, [p]: val }));
			const save = async () => {
				setBusy(true); setErr(null); setMsg(null);
				try {
					const body = {};
					for (const p of ["wechat", "wecom", "feishu", "dingtalk"]) {
						const c = (cfg && cfg[p]) || {};
						body[p] = {
							enabled: !!c.enabled,
							appId: (c.appId || "").trim(),
							agentId: (c.agentId || "").trim(),
							secret: (secrets[p] || "").trim(),
						};
					}
					const v = await madaziFetch("/admin/oauth", { method: "PUT", body: JSON.stringify(body) });
					if (v && v.error) { setErr(typeof v.error === "object" ? JSON.stringify(v.error) : v.error); return; }
					setMsg("已保存（最多 10 秒生效）");
					setSecrets({});
					load();
				} catch (e) { setErr(String((e && e.message) || e)); }
				finally { setBusy(false); }
			};
			const META = {
				wechat: { name: "微信", appIdPh: "AppID（开放平台）", agent: false },
				wecom: { name: "企业微信", appIdPh: "CorpID（企业ID）", agent: true },
				feishu: { name: "飞书", appIdPh: "App ID", agent: false },
				dingtalk: { name: "钉钉", appIdPh: "AppKey", agent: false },
			};
			return h("div", { className: "madazi-form", style: { border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 8, flexDirection: "column", alignItems: "stretch", gap: 10 } },
				h("div", { style: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, "三方登录"),
				h("div", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary, #888)" } }, "配置后登录页出现对应扫码入口；Secret 留空 = 不修改（已配置自动保留）"),
				cfg === null
					? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #888)" } }, "加载中…")
					: ["wechat", "wecom", "feishu", "dingtalk"].map((p) => {
						const meta = META[p];
						const c = cfg[p] || {};
						return h("div", { key: p, style: { display: "flex", flexDirection: "column", gap: 6, padding: 8, borderRadius: 8, background: "var(--dsw-alias-bg-base,rgba(0,0,0,.04))" } },
							h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
								h("label", { style: { display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--dsw-alias-label-primary)" } },
									h("input", { type: "checkbox", checked: !!c.enabled, onChange: (e) => setOf(p, "enabled", e.target.checked) }),
									meta.name
								),
								c.hasSecret ? h("span", { style: { fontSize: 11, color: "var(--dsw-alias-state-success-primary,#34C759)" } }, "Secret 已配置") : null
							),
							h("input", { className: "madazi-inp", placeholder: meta.appIdPh, value: c.appId || "", onChange: (e) => setOf(p, "appId", e.target.value) }),
							meta.agent ? h("input", { className: "madazi-inp", placeholder: "AgentID（企业微信应用）", value: c.agentId || "", onChange: (e) => setOf(p, "agentId", e.target.value) }) : null,
							h("input", { className: "madazi-inp", type: "password", placeholder: c.hasSecret ? "App Secret（留空不修改）" : "App Secret", value: secrets[p] || "", onChange: (e) => setSecret(p, e.target.value) })
						);
					}),
				err ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, "API: " + err) : null,
				msg ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-success-primary,#34C759)" } }, msg) : null,
				h("button", { className: "madazi-btn-pri", disabled: busy || cfg === null, onClick: save }, busy ? "保存中…" : "保存")
			);
		};
