	// ── @ 跨项目文件引用（第二个 @ 源：官方源之外的兜底扩展） ──────────────────────────
	// 官方 @ 源（ui-reference）只搜当前会话 cwd（当前项目）；本源补跨项目：
	// GET /api/projects/search-files（cookie 认证，服务端按成员权限过滤，见 projects.js）。
	// 候选按项目名分 section（以项目区分开）；mention 用绝对路径 /app/generated/<pid>/…
	// （与 dsh 容器同 PVC 同路径，agent 的 read 工具可直接读）。
	// 目录候选 drill 可逐级下钻：query 变为绝对路径前缀，服务端直列该目录子项。
	// 多源共存依据：inputTriggers 的 (trigger, name) 唯一即可，roster 按 order 排序——
	// 官方 reference 源 order 0 在前，本源 order 5 在后（当前项目结果优先，跨项目补充）。
	const installCrossProjectRef = (ctx) => {
		if (window.__madaziCrossRefInstalled) return;
		const svc = (ctx.inputTriggers && typeof ctx.inputTriggers.registerSource === "function")
			? ctx.inputTriggers
			: (typeof ctx.get === "function" ? ctx.get("inputTriggers") : null);
		if (!svc || typeof svc.registerSource !== "function") { console.warn("[madazi] inputTriggers 不可用，跨项目 @ 未注册"); return; }

		// mention 文法（与官方 formatFileMention 同语义）：目录尾斜杠保持 token 开启（下钻续打）
		const _xrefMention = (absPath, isDir) => {
			const p = isDir ? absPath + "/" : absPath;
			if (/[\u0000-\u001f\u007f-\u009f"]/u.test(p)) return null;
			const q = /\s/u.test(p);
			if (isDir) return q ? "@\"" + p : "@" + p;
			return q ? "@\"" + p + "\"" : "@" + p;
		};

		const source = {
			trigger: "@",
			name: "madazi-cross-project",
			order: 5,
			showGroupTitle: false,
			candidates: async (session, req) => {
				const q = String((req && req.query) || "");
				try {
					// 排除当前项目（官方 @ 源已覆盖 cwd 内文件，避免两源重复列出）
					let exclude = "";
					try {
						const pid = _pidOfSession(ctx, session && session.sessionId);
						if (pid) exclude = "&exclude=" + encodeURIComponent(pid);
					} catch (e) { /* ignore */ }
					const d = await madaziFetch("/projects/search-files?q=" + encodeURIComponent(q) + "&limit=12" + exclude, {
						signal: (req && req.signal) || undefined,
					});
					if (!d || d.error || !Array.isArray(d.items)) return [];
					const out = [];
					for (const it of d.items) {
						if (!it || !it.absPath) continue;
						const isProj = it.kind === "project";
						const isDir = isProj || it.kind === "directory";
						const mention = _xrefMention(String(it.absPath), isDir);
						if (!mention) continue;
						const label = isProj ? String(it.projectName || "项目") : String(it.absPath.slice(it.absPath.lastIndexOf("/") + 1));
						const slash = it.relPath ? String(it.relPath).lastIndexOf("/") : -1;
						const parent = slash > 0 ? String(it.relPath).slice(0, slash) : "";
						out.push({
							name: label + (isDir ? "/" : ""),
							description: isProj ? "跨项目文件" : (parent || "（项目根）"),
							icon: isDir ? "folder" : "file",
							section: isProj ? "项目" : String(it.projectName || "项目"),
							value: JSON.stringify({ kind: "file", fileKind: isDir ? "directory" : "file", label, mention }),
							...(isDir ? { drill: true } : {}),
						});
					}
					return out;
				} catch (e) { return []; }
			},
			onPick: ({ candidate, action }) => {
				try {
					const v = JSON.parse(candidate.value);
					if (v.fileKind === "directory" && action === "drill") return { text: v.mention, continue: true };
					return { insert: {
						source: "madazi-cross-project",
						ref: v.mention,
						label: v.fileKind === "directory" ? v.label + "/" : v.label,
						appearance: v.fileKind === "directory" ? "folder" : "file",
						clipboardText: v.mention,
					} };
				} catch (e) { return undefined; }
			},
			// 发送时芯片序列化：mention 原文即模型形态（绝对路径 @ 引用，agent read 可读）
			codec: {
				clipboardText: (ref) => ref,
				serialize: (ref) => Promise.resolve(ref),
			},
		};
		try {
			svc.registerSource(source);
			window.__madaziCrossRefInstalled = true;
		} catch (e) { console.warn("[madazi] 跨项目 @ 注册失败:", e); }
	};
