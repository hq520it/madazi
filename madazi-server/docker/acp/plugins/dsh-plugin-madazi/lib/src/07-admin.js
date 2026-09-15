		/** Admin section in the settings panel (P4, admin only): user roster
		 * (create / role change / delete) + all platform keys (revoke). */
		const AdminSection = ({ close, onOpenProject }) => {
			// 管理 tab 内子 tab：users（用户管理）/ keys（三方登录）/ userkeys（用户 Key）/ system（系统设置）
			const [tab, setTab] = useState("users");
			// 用户管理：添加用户弹窗开关（点「＋」弹出，不默认展示表单）
			const [addOpen, setAddOpen] = useState(false);
			// 用户管理：重置密码弹窗（管理员给指定用户设新密码）
			const [pwdUser, setPwdUser] = useState(null); // 正在重置密码的用户（null = 关闭）
			const [nPwd, setNPwd] = useState("");
			const [pwdErr, setPwdErr] = useState(null);
			const [pwdBusy, setPwdBusy] = useState(false);
			// 用户 Key：签发时绑定到哪个用户（key 泄露场景：吊销旧 key → 选该用户签发新 key）
			const [issueUser, setIssueUser] = useState("");
			const [users, setUsers] = useState(null);
			const [keys, setKeys] = useState(null);
			const [error, setError] = useState(null);
			const [msg, setMsg] = useState(null);
			// Key 与登录：签发新 key（POST /keys）
			const [kErr, setKErr] = useState(null);
			const [kOk, setKOk] = useState(null);
			const [newKey, setNewKey] = useState(null);
			const [kBusy, setKBusy] = useState(false);
			// 预览回收设置（GET/PUT /admin/settings，server 侧白名单 preview_idle_timeout）
			const [idleHours, setIdleHours] = useState("");
			const [idleBusy, setIdleBusy] = useState(false);
			const [idleMsg, setIdleMsg] = useState(null);
			const loadIdle = () => {
				madaziFetch("/admin/settings").then((v) => {
					if (v && !v.error && v.preview_idle_timeout !== undefined) {
						const h = Number(v.preview_idle_timeout) / 3600;
						setIdleHours(String(Math.round(h * 100) / 100));
					}
				}).catch(() => {});
			};
			const saveIdle = async () => {
				const hNum = Number(idleHours);
				if (!Number.isFinite(hNum) || hNum < 0) { setIdleMsg("请输入非负数字（小时，0 = 不回收）"); return; }
				setIdleBusy(true); setIdleMsg(null);
				try {
					const v = await madaziFetch("/admin/settings", { method: "PUT", body: JSON.stringify({ settings: { preview_idle_timeout: String(Math.round(hNum * 3600)) } }) });
					if (v && v.error) { setIdleMsg("保存失败：" + (typeof v.error === "object" ? JSON.stringify(v.error) : v.error)); return; }
					setIdleMsg("已保存：闲置 " + hNum + " 小时后自动停止预览" + (hNum === 0 ? "（已关闭回收）" : ""));
				} catch (e) { setIdleMsg(String((e && e.message) || e)); }
				finally { setIdleBusy(false); }
			};
			const [busy, setBusy] = useState(false);
			// create-user form
			const [nU, setNU] = useState("");
			const [nP, setNP] = useState("");
			const [nR, setNR] = useState("user");
			const [nErr, setNErr] = useState(null);
			// M4 模板审核：待审队列 + 展开详情 + 驳回 reason
			const [pending, setPending] = useState(null);
			const [pendErr, setPendErr] = useState(null);
			const [pendBusy, setPendBusy] = useState(null); // 审核操作中的 version_id
			const [readmeFor, setReadmeFor] = useState(null); // 展开 README 的 version_id
			const [readme, setReadme] = useState(null);
			const [rejectFor, setRejectFor] = useState(null); // 驳回输入中的 version_id
			const [rejectReason, setRejectReason] = useState("");
			const loadPending = () => {
				setPendErr(null);
				madaziFetch("/admin/market/pending").then((v) => {
					if (v && v.error) { setPendErr(v.error); return; }
					setPending(Array.isArray(v) ? v : []);
				}).catch((e) => setPendErr(String((e && e.message) || e)));
			};
			const toggleReadme = (item) => {
				if (readmeFor === item.version_id) { setReadmeFor(null); setReadme(null); return; }
				setReadmeFor(item.version_id); setReadme(null);
				madaziFetch("/market/templates/" + encodeURIComponent(item.slug)).then((d) => {
					setReadme(d && d.readme ? d.readme : "（无 README）");
				}).catch(() => setReadme("（读取失败）"));
			};
			const review = async (item, approved) => {
				if (pendBusy) return;
				if (approved && !window.confirm(`批准「${item.name} v${item.version}」上架？`)) return;
				setPendBusy(item.version_id);
				setPendErr(null);
				try {
					const v = await madaziFetch(`/admin/market/templates/${item.id}/versions/${item.version_id}/${approved ? "approve" : "reject"}`,
						approved ? { method: "POST" } : { method: "POST", body: JSON.stringify({ reason: rejectReason.trim() }) });
					if (v && v.error) { setPendErr(v.error); return; }
					setMsg(approved ? `已批准 ${item.name} v${item.version}` : `已驳回 ${item.name} v${item.version}`);
					setRejectFor(null); setRejectReason(""); setReadmeFor(null);
					loadPending();
				} catch (e) {
					setPendErr(String((e && e.message) || e));
				} finally {
					setPendBusy(null);
				}
			};
			const load = () => {
				setError(null);
				// ★ 2026-09-13 改浏览器同源 cookie 直连（与平台面板同模式）：bridge RPC 走
				//   node 半无服务令牌 → server 401 → 前端报 gateway/internal。直连避免鉴权断层。
				madaziFetch("/admin/users").then((v) => {
					if (v && v.error) { setError(typeof v.error === "object" ? JSON.stringify(v.error) : v.error); return; }
					setUsers(Array.isArray(v) ? v : []);
				}).catch((e) => setError(String((e && e.message) || e)));
				madaziFetch("/keys/all").then((v) => {
					if (v && v.error) return;
					setKeys(Array.isArray(v) ? v : []);
				}).catch(() => {});
				loadPending();
			};
			useEffect(() => { load(); loadIdle(); }, []);
			const mkUser = async () => {
				if (busy) return;
				if (!nU.trim() || !nP) { setNErr("用户名与密码必填"); return; }
				setBusy(true);
				setNErr(null);
				setMsg(null);
				try {
					const data = await madaziFetch("/admin/users", { method: "POST", body: JSON.stringify({ username: nU.trim(), password: nP, role: nR }) });
					if (data && data.error) { setNErr(typeof data.error === "object" ? JSON.stringify(data.error) : data.error); return; }
					setMsg("用户已创建");
					setNU(""); setNP("");
					setAddOpen(false); // 创建成功关闭弹窗
					load();
				} catch (e) {
					setNErr(String((e && e.message) || e));
				} finally {
					setBusy(false);
				}
			};
			const chRole = async (id, role) => {
				try {
					const data = await madaziFetch(`/admin/users/${encodeURIComponent(id)}/role`, { method: "PUT", body: JSON.stringify({ role }) });
					if (data && data.error) { setError(typeof data.error === "object" ? JSON.stringify(data.error) : data.error); return; }
					setMsg("角色已更新");
					load();
				} catch (e) { setError(String((e && e.message) || e)); }
			};
			const delUser = async (id) => {
				try {
					const data = await madaziFetch(`/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });
					if (data && data.error) { setError(typeof data.error === "object" ? JSON.stringify(data.error) : data.error); return; }
					setMsg("用户已删除");
					load();
				} catch (e) { setError(String((e && e.message) || e)); }
			};
			// 重置密码（管理员给指定用户设新密码）：直连 server（同源 cookie，adminOnly），
			// PUT /admin/users/:id/password（后端已存在）
			const resetPwd = async () => {
				if (pwdBusy || !pwdUser) return;
				if (!nPwd || nPwd.length < 6) { setPwdErr("密码至少 6 位"); return; }
				setPwdBusy(true); setPwdErr(null);
				try {
					const v = await madaziFetch("/admin/users/" + encodeURIComponent(pwdUser.id) + "/password", { method: "PUT", body: JSON.stringify({ password: nPwd }) });
					if (v && v.error) { setPwdErr(typeof v.error === "object" ? JSON.stringify(v.error) : v.error); return; }
					setMsg("已重置 " + (pwdUser.username || pwdUser.id) + " 的密码");
					setPwdUser(null); setNPwd("");
				} catch (e) {
					setPwdErr(String((e && e.message) || e));
				} finally {
					setPwdBusy(false);
				}
			};
			const revoke = async (id) => {
				try {
					const data = await madaziFetch(`/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
					if (data && data.error) { setError(typeof data.error === "object" ? JSON.stringify(data.error) : data.error); return; }
					setMsg("key 已吊销");
					load();
				} catch (e) { setError(String((e && e.message) || e)); }
			};
			// ★ 签发新 key（原平台 tab 的 API Keys 入口，合并到管理 → Key 与登录）
			const mkKey = async () => {
				if (kBusy) return;
				setKBusy(true);
				setKErr(null);
				setKOk(null);
				setNewKey(null);
				try {
					// admin 签发可绑定到指定用户（userId）；未选则签给自己
					const body = { name: "dsh 客户端" };
					if (issueUser) body.userId = issueUser;
					const k = await madaziFetch("/keys", { method: "POST", body: JSON.stringify(body) });
					if (k && k.error) { setKErr(typeof k.error === "object" ? JSON.stringify(k.error) : k.error); return; }
					setNewKey(k && (k.apiKey || k.key || k.rawKey) ? (k.apiKey || k.key || k.rawKey) : (k && k.key_prefix ? "创建成功：" + k.key_prefix + "***" : "创建成功"));
					setKOk("新 key 已创建");
					load();
				} catch (e) {
					setKErr(String((e && e.message) || e));
				} finally {
					setKBusy(false);
				}
			};
			// 用户 ↔ key 对应（按用户名分组，供「用户 Key」子 tab 展示）
			const groupedKeys = {};
			(keys || []).forEach((k) => {
				const uname = k.username || k.user_id || "未知用户";
				(groupedKeys[uname] = groupedKeys[uname] || []).push(k);
			});
			return h("div", { className: "madazi-settings" },
				h("div", { className: "madazi-settings-hd" },
					h("div", null,
						h("div", { className: "madazi-settings-title" }, "管理"),
						h("div", { className: "madazi-settings-sub" }, "用户 · 三方登录 · 用户 Key · 系统设置（仅管理员）")
					),
					h("button", { className: "madazi-settings-refresh", onClick: () => { load(); loadIdle(); } }, "刷新")
				),
				msg ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-success-primary,#34C759)" } }, msg) : null,
				error ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, "API: " + error) : null,
				// ── 管理内子 tab 导航 ──
				h("div", { className: "madazi-admin-tabs" },
					h("button", { className: "madazi-admin-tab" + (tab === "users" ? " on" : ""), onClick: () => setTab("users") }, "用户管理"),
					h("button", { className: "madazi-admin-tab" + (tab === "keys" ? " on" : ""), onClick: () => setTab("keys") }, "三方登录"),
					h("button", { className: "madazi-admin-tab" + (tab === "userkeys" ? " on" : ""), onClick: () => setTab("userkeys") }, "用户 Key"),
					h("button", { className: "madazi-admin-tab" + (tab === "system" ? " on" : ""), onClick: () => setTab("system") }, "系统设置")
				),
				// ── 系统设置：预览回收（闲置时长）──
				tab === "system" ? h("div", { className: "madazi-form", style: { border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 8 } },
					h("div", { style: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, "预览回收"),
					h("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
						h("input", { className: "madazi-inp", style: { width: 90 }, value: idleHours, inputMode: "decimal", placeholder: "24", onChange: (e) => setIdleHours(e.target.value) }),
						h("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #888)", flex: 1, minWidth: 200 } }, "小时无访问后自动停止预览（0 = 不回收；默认 24）"),
						h("button", { className: "madazi-btn-pri", disabled: idleBusy, onClick: saveIdle }, idleBusy ? "保存中…" : "保存")
					),
					idleMsg ? h("div", { style: { fontSize: 12, color: idleMsg.indexOf("失败") !== -1 || idleMsg.indexOf("请输入") !== -1 ? "var(--dsw-alias-state-error-primary,#FF453A)" : "var(--dsw-alias-state-success-primary,#34C759)" } }, idleMsg) : null
				) : null,
				// ── 三方登录（OAuth 配置，仅管理员）──
				tab === "keys" ? h(OauthSettingsSection, null) : null,
				// ── 用户管理：用户列表 + 添加按钮（点「＋」弹窗添加，不默认展示表单）──
				tab === "users" ? h("div", { className: "madazi-settings-list" },
					h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
						h("div", { style: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, "用户"),
						h("button", { className: "madazi-settings-open", title: "添加用户", onClick: () => { setNErr(null); setAddOpen(true); } }, "＋")
					),
					users === null ? h("div", { className: "madazi-pop-d" }, "加载中…")
						: users.length === 0 ? h("div", { className: "madazi-pop-d" }, "暂无用户")
							: users.map((u) =>
							// ★ 类名用 madazi-admin-user-row（避开 login 插件的 .madazi-user-row
							//   委托监听——否则点击设置面板里的用户行会被误判为「点侧栏用户」，
							//   弹出含「退出登录」的用户菜单）
							h("div", { key: u.id, className: "madazi-admin-user-row" },
								h("div", { style: { minWidth: 0 } },
									h("div", { className: "un" }, u.username || u.email || u.id, " ",
										h("span", { className: "madazi-role-badge" }, u.role || "user")),
									h("div", { className: "meta" }, u.email || u.id)
								),
								h("div", { style: { display: "flex", gap: 6, alignItems: "center" } },
									u.role !== "admin"
										? h("button", { className: "madazi-btn-ghost", style: { padding: "2px 8px" }, onClick: () => chRole(u.id, "admin") }, "设管理员")
										: h("button", { className: "madazi-btn-ghost", style: { padding: "2px 8px" }, onClick: () => chRole(u.id, "user") }, "降为普通"),
									h("button", { className: "madazi-btn-ghost", style: { padding: "2px 8px" }, onClick: () => { setPwdErr(null); setNPwd(""); setPwdUser(u); } }, "重置密码"),
									h("button", { className: "madazi-btn-danger", onClick: () => delUser(u.id) }, "删除")
								)
							)
						)
				) : null,
				// ── 添加用户弹窗 ──
				addOpen ? h(Modal, {
					open: true,
					onClose: () => setAddOpen(false),
					title: "添加用户",
					closeLabel: "关闭",
					footer: h(Button, { variant: "primary", size: "md", disabled: busy, onClick: mkUser }, busy ? "创建中…" : "创建用户"),
					children: h("div", { className: "madazi-form", style: { gap: 10 } },
						h("input", { className: "madazi-inp", value: nU, placeholder: "用户名", onChange: (e) => setNU(e.target.value) }),
						h("input", { className: "madazi-inp", type: "password", value: nP, placeholder: "初始密码", onChange: (e) => setNP(e.target.value) }),
						h("select", { className: "madazi-sel", value: nR, onChange: (e) => setNR(e.target.value) },
							h("option", { value: "user" }, "user"),
							h("option", { value: "admin" }, "admin")
						),
						nErr ? h("div", { className: "madazi-create-err" }, nErr) : null
					)
				}) : null,
				// ── 重置密码弹窗 ──
				pwdUser ? h(Modal, {
					open: true,
					onClose: () => { setPwdUser(null); setNPwd(""); setPwdErr(null); },
					title: "重置密码 · " + (pwdUser.username || pwdUser.id),
					closeLabel: "关闭",
					footer: h(Button, { variant: "primary", size: "md", disabled: pwdBusy, onClick: resetPwd }, pwdBusy ? "重置中…" : "确认重置"),
					children: h("div", { className: "madazi-form", style: { gap: 10 } },
						h("input", { className: "madazi-inp", type: "password", value: nPwd, placeholder: "新密码（至少 6 位）", onChange: (e) => setNPwd(e.target.value) }),
						pwdErr ? h("div", { className: "madazi-create-err" }, pwdErr) : null
					)
				}) : null,
			tab === "userkeys" ? h("div", { className: "madazi-settings-list" },
				h("div", { className: "madazi-settings-row", style: { flexDirection: "column", alignItems: "stretch", gap: 8 } },
					h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
						h("div", { className: "madazi-settings-row-n" }, "签发 API Key"),
						h("button", { className: "madazi-settings-open", disabled: kBusy || !issueUser, onClick: mkKey }, kBusy ? "签发中…" : "＋签发")
					),
					h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
						h("select", { className: "madazi-sel", style: { flex: 1 }, value: issueUser, onChange: (e) => setIssueUser(e.target.value) },
							h("option", { value: "" }, "选择要绑定的用户…"),
							(users || []).map((u) => h("option", { key: u.id, value: u.id }, u.username || u.email || u.id))
						)
					),
					h("div", { style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary, #888)" } }, "key 泄露时：吊销旧 key → 选该用户签发新 key（绑定到该用户名下）"),
					newKey ? h("div", { style: { fontSize: 12, wordBreak: "break-all", padding: "6px 8px", borderRadius: 6, background: "rgba(52,199,89,.1)", color: "var(--dsw-alias-state-success-primary,#34C759)", lineHeight: 1.5 } },
						"新 key（仅此一次可见）：", newKey) : null,
					kOk ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-success-primary,#34C759)" } }, kOk) : null,
					kErr ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary,#FF453A)" } }, "Key: " + kErr) : null
				)
			) : null,
			// ── 用户 Key：所有用户 ↔ key 对应（吊销 = 控制 key 激活）──
			tab === "userkeys" ? h("div", { className: "madazi-settings-list" },
				h("div", { style: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, "用户与 API Key 对应"),
				h("div", { style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary, #888)" } }, "吊销 = 该 key 立即失效（用户无法再用它调用 AI）；用户重新登录会自动轮换签发新 key"),
				keys === null ? h("div", { className: "madazi-pop-d" }, "加载中…")
					: keys.length === 0 ? h("div", { className: "madazi-pop-d" }, "暂无 key")
						: Object.keys(groupedKeys).map((uname) =>
							h("div", { key: uname, style: { display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 } },
								h("div", { style: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-primary)", marginTop: 4 } }, uname),
								groupedKeys[uname].map((k) =>
									h("div", { key: k.id, className: "madazi-key-row" },
										h("span", { className: "madazi-key-prefix" }, k.key_prefix || k.id),
										h("span", { style: { display: "flex", gap: 6, alignItems: "center" } },
											h("span", { className: "madazi-key-st " + (k.status === "revoked" ? "revoked" : "active") }, k.status === "revoked" ? "已吊销" : "活跃"),
											k.status !== "revoked" ? h("button", { className: "madazi-btn-danger", onClick: () => revoke(k.id) }, "吊销") : null
										)
									)
								)
							)
						)
			) : null,
			// ── 系统设置：模板审核（公开模板发布队列）──
			tab === "system" ? h("div", { className: "madazi-settings-list" },
				h("div", { style: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-primary)", display: "flex", alignItems: "center", gap: 6 } },
					"模板审核",
					pending && pending.length ? h("span", { className: "madazi-badge", style: { minWidth: 18 } }, pending.length) : null),
				pendErr ? h("div", { className: "madazi-pop-d" }, "审核队列: " + pendErr)
					: pending === null ? h("div", { className: "madazi-pop-d" }, "加载中…")
						: pending.length === 0 ? h("div", { className: "madazi-pop-d" }, "暂无待审核模板")
							: pending.map((it) =>
								h("div", { key: it.version_id, className: "madazi-settings-row", style: { flexDirection: "column", alignItems: "stretch", gap: 8 } },
									h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" } },
										h("div", { style: { minWidth: 0 } },
											h("div", { className: "madazi-settings-row-n" },
												it.name || it.slug, " ",
												h("span", { style: { fontSize: 11, color: "var(--dsw-alias-accent-primary,#4c8ffd)" } }, "v" + it.version),
												" ",
												h("span", { className: "madazi-mkt-badge pending" }, "待审核")),
											h("div", { className: "madazi-settings-row-d", style: { maxWidth: "none", whiteSpace: "normal" } },
												it.slug + " · " + (it.author_name || "未知作者") + " · " + (it.category || "fullstack")
												+ " · " + (it.file_count || 0) + " 文件 · " + ((it.pkg_size || 0) / 1024 / 1024).toFixed(2) + " MB"
												+ " · " + mktDate(it.version_created_at) + " 提交"),
											it.changelog ? h("div", { className: "madazi-settings-row-d", style: { maxWidth: "none", whiteSpace: "normal" } }, "更新说明：" + it.changelog) : null,
											Array.isArray(it.tags) && it.tags.length ? h("div", { className: "madazi-mkt-tags", style: { marginTop: 4 } },
												it.tags.map((tag) => h("span", { key: tag }, tag))) : null),
										h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" } },
											h("button", { className: "madazi-btn-ghost", style: { padding: "2px 8px" }, onClick: () => toggleReadme(it) },
												readmeFor === it.version_id ? "收起 README" : "查看 README"),
											h("button", { className: "madazi-settings-open", disabled: !!pendBusy, onClick: () => review(it, true) },
												pendBusy === it.version_id ? "审核中…" : "批准上架"),
											h("button", { className: "madazi-btn-danger", disabled: !!pendBusy, onClick: () => { setRejectFor(rejectFor === it.version_id ? null : it.version_id); setRejectReason(""); } }, "驳回"))
									),
									// 展开 README
									readmeFor === it.version_id ? h("div", { className: "madazi-mkt-readme" },
										readme === null ? "加载中…" : readme) : null,
									// 驳回 reason 输入
									rejectFor === it.version_id ? h("div", { style: { display: "flex", gap: 6, alignItems: "flex-start" } },
										h("textarea", {
											className: "madazi-inp", rows: 2, value: rejectReason,
											placeholder: "驳回原因（将展示给作者）…",
											onChange: (e) => setRejectReason(e.target.value),
										}),
										h("button", { className: "madazi-btn-danger", style: { flex: "none" }, disabled: !!pendBusy, onClick: () => review(it, false) }, "确认驳回")) : null
								)
							)
			) : null
		);


