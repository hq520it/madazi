		/**
	 * S6-official 预览控制（零注入试水）：注册到官方 conversation.input.right 槽
	 * （输入区工具行右侧，list 孔）。取代 IIFE 段 ctlBtn 的 DOM hack——
	 * 启动/停止预览 + 状态圆点。projectId 来源 = 当前 workspace path
	 * （/app/generated/<id>，与 openProjectWorkspace 约定一致），
	 * 不依赖地址栏 DOM。打开/导航仍走官方浏览器视图（无第三方导航 API）。
	 */
	// S6-official：内部 ErrorBoundary——捕获 Button（primitives）在 slot 孔内的渲染错误，
	// 不连累整个 slot（官方 lu boundary 会吞掉并渲染 data-slot-error 占位）
	class PVBoundary extends react.Component {
		constructor(p) { super(p); this.state = { failed: null }; }
		static getDerivedStateFromError(e) { return { failed: String((e && e.message) || e) }; }
		render() { return this.state.failed ? null : this.props.children; }
	}

	const PV_HIS_KEY = "madazi.previewHistory";
	const PV_MAX_HIS = 10;
	const pvLoadHistory = () => {
		try { return JSON.parse(localStorage.getItem(PV_HIS_KEY) || "[]"); } catch (e) { return []; }
	};
	const pvSaveHistory = (list) => {
		try { localStorage.setItem(PV_HIS_KEY, JSON.stringify(list.slice(0, PV_MAX_HIS))); } catch (e) { /* ignore */ }
	};
	const pvPushHistory = (item) => {
		const list = pvLoadHistory().filter((x) => x.id !== item.id);
		list.unshift({ name: item.name || "项目", id: item.id, t: Date.now() });
		pvSaveHistory(list);
	};

	// S6-official：useWorkspaces hook 崩溃源实锤（w is not a function，store hook 在 slot 上下文不可用）
	// → 改走官方 workspaces client service 快照（window.__madaziWs = ctx.workspaces，非 hook，零崩溃）
	// 预览控制组：历史/项目下拉（切换预览目标）+ 状态圆点 + 启停按钮，全走 madazi RPC
	const PreviewControl = (props) => {
		const [pid, setPid] = useState(null);
		const [options, setOptions] = useState([]); // [{id,name,hist}]
		const [running, setRunning] = useState(null); // null=未知
		const [busy, setBusy] = useState(false);
		const svc = window.__madaziSvc || null;
		const ws = window.__madaziWs || null;

		// 合并候选：localStorage 历史（优先）+ 当前工作区快照项目
		const collect = () => {
			const out = [];
			const seen = {};
			const push = (id, name, hist) => {
				if (!id || seen[id]) return;
				seen[id] = 1;
				out.push({ id, name: name || id.slice(0, 8), hist: !!hist });
			};
			pvLoadHistory().forEach((x) => push(x.id, x.name, true));
			try {
				if (ws && ws.list && typeof ws.list.getSnapshot === "function") {
					const snap = ws.list.getSnapshot();
					const items = (snap && (snap.items || snap.workspaces || snap.list)) || [];
					items.forEach((w) => {
						const path = w && (w.path || w.dir || "");
						const m = path && path.match(/\/generated\/([^/]+)$/);
						if (m) push(m[1], w.title || w.name || null, false);
					});
				}
			} catch (e) { /* ignore */ }
			return out;
		};

		useEffect(() => {
			const apply = () => {
				const list = collect();
				setOptions(list);
				// 优先当前激活工作区（快照 recentWorkspaceId）；否则保持现有选择；否则候选第一条
				let preferred = null;
				try {
					if (ws && ws.list && typeof ws.list.getSnapshot === "function") {
						const snap = ws.list.getSnapshot();
						const recent = snap && (snap.recentWorkspaceId || snap.current);
						if (recent) {
							const items = (snap && (snap.items || snap.workspaces || snap.list)) || [];
							const cur = items.find((w) => w && (w.id === recent || w.workspaceId === recent));
							const path = cur && (cur.path || cur.dir || "");
							const m = path && path.match(/\/generated\/([^/]+)$/);
							if (m) preferred = m[1];
						}
					}
				} catch (e) { /* ignore */ }
				setPid((cur) => (preferred || (cur && list.some((o) => o.id === cur) ? cur : (list[0] ? list[0].id : null))));
			};
			apply();
			let unsub = null;
			try { if (ws && ws.list && typeof ws.list.subscribe === "function") unsub = ws.list.subscribe(apply); } catch (e) { /* ignore */ }
			return () => { if (unsub) { try { unsub(); } catch (e) { /* ignore */ } } };
		}, []);

		// 状态查询 + 15s 周期兜底（外部停止/超时后按钮不刷新）
		useEffect(() => {
			if (!pid || !svc) { setRunning(null); return; }
			let alive = true;
			const q = () => {
				svc.previewStatus(pid).then((d) => {
					if (!alive) return;
					const v = d && d.ok ? d.value : d;
					setRunning(!!(v && (v.running || v.status === "running")));
				}).catch(() => { if (alive) setRunning(null); });
			};
			q();
			const iv = setInterval(q, 15000);
			return () => { alive = false; clearInterval(iv); };
		}, [pid]);

		const act = (fn) => {
			if (!pid || busy) return;
			setBusy(true);
			fn(pid).then((d) => {
				const v = d && d.ok ? d.value : d;
				if (v && v.running !== undefined) setRunning(!!v.running);
				else if (v && v.status) setRunning(v.status === "running");
				pvPushHistory({ id: pid, name: (options.find((o) => o.id === pid) || {}).name || null });
				setBusy(false);
			}).catch(() => { setBusy(false); });
		};
		const onPick = (e) => {
			const v = e && e.target && e.target.value;
			if (!v) return;
			setPid(v);
			setRunning(null);
		};
		const runningText = running ? "停止预览" : (running === null ? "预览…" : "启动预览");
		const targetFn = svc ? (running ? svc.previewStop : svc.previewStart) : null; // render 阶段安全求值（svc 为 null 时不崩）
		return h(PVBoundary, null,
			h("div", {
				style: { display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 6 },
				title: pid ? (((options.find((o) => o.id === pid) || {}).name || pid) + " 预览控制") : "未识别预览项目"
			},
			h(Button, {
				size: "small",
				disabled: !pid || busy || !targetFn,
				onClick: () => { if (targetFn) act(targetFn); }
			}, runningText),
			h("span", { style: { width: 6, height: 6, borderRadius: 999, background: running ? "var(--dsw-alias-state-success-primary,#34C759)" : (running === null ? "#8b949e" : "var(--dsw-alias-state-warning-primary,#FF9F0A)"), display: "inline-block", flex: "0 0 auto" } }),
			h("select", {
				value: pid || "",
				onChange: onPick,
				disabled: !options.length,
				style: { maxWidth: 140, fontSize: 12, height: 26, borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2, #333)", background: "var(--dsw-alias-bg-base, #1e1e1e)", color: "var(--dsw-alias-label-primary, #e0e0e0)" }
			}, options.map((o) => h("option", { key: o.id, value: o.id }, (o.hist ? "◷ " : "") + o.name)))
			)
		);
	};
	exports.MadaziPanel = MadaziPanel;
		exports.ProjectDirectoryFlow = ProjectDirectoryFlow;
		exports.ProjectsEntry = ProjectsEntry;
		exports.PlatformSection = PlatformSection;
		exports.AdminSection = AdminSection;
		exports.apply = apply;
		exports.inject = inject;
