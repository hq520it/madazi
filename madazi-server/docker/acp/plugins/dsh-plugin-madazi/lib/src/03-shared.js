		/** Render one project row. */
		const ProjectRow = (p) => h("div", { className: "p", key: p.id },
			h("span", { className: "pn" }, p.name || p.id),
			h("span", { className: "pd" }, p.description || "")
		);

		/** Platform panel docked into the composer area: lists madazi projects via the node-half bridge. */
		const MadaziPanel = (props) => {
			const [projects, setProjects] = useState(null);
			const [error, setError] = useState(null);
			useEffect(() => {
				if (!props.fetchProjects) return;
				let alive = true;
				const tryFetch = (attempt) => {
					if (!alive) return;
					// 8s 超时保护：RPC 通道挂起时不再永久 loading
					const timed = Promise.race([
						props.fetchProjects(),
						new Promise((_, rej) => setTimeout(() => rej(new Error("RPC_TIMEOUT 8s")), 8000))
					]);
					timed.then((data) => {
						if (!alive) return;
						if (data && data.error) {
							window.__madaziLastErr = { phase: "data.error", data };
							if (attempt < 8) { setTimeout(() => tryFetch(attempt + 1), 1500); return; }
							setError(typeof data.error === "object" ? JSON.stringify(data.error) : data.error);
							return;
						}
						const list = data && data.ok ? data.value : data;
						setProjects(Array.isArray(list) ? list : []);
					}).catch((e) => {
						if (!alive) return;
						window.__madaziLastErr = { phase: "reject", msg: String(e && e.message), stack: String(e && e.stack).slice(0, 400) };
						if (attempt < 8) { setTimeout(() => tryFetch(attempt + 1), 1500); return; }
						setError(String((e && e.message) || e));
					});
				};
				tryFetch(0);
				return () => { alive = false; };
			}, []);
			const rows = projects === null
				? h("div", { className: "d" }, "加载平台项目…")
				: projects.length === 0
					? h("div", { className: "d" }, "暂无项目")
					: projects.map(ProjectRow);
			return h("div", { className: "madazi-hello" },
				h("div", { className: "t" },
					h("span", null, "Madazi 平台面板"),
					h("span", { className: "badge" }, "平台项目")
				),
				error ? h("div", { className: "d" }, "API: " + error) : rows
			);
		};

		/**
		 * Directory-flow occupant: replaces the built-in directory browser in the
		 * "Add workspace" flow. Picking a platform project adopts its directory as
		 * a workspace (owner calls createWorkspace + opens a session).
		 * Registered at priority -1 to shadow dsh-client-ui-directory-picker-browse.
		 */
		// ── 平台模板解析：id 形如 react-node / react+node / uniapp-springboot ──
		const parseTemplates = (templates) => (templates || []).map((t) => {
			const id = t.id || "";
			const m = id.match(/^([a-zA-Z]+)[+-]([a-zA-Z]+)$/);
			return { ...t, front: m ? m[1] : "", back: m ? m[2] : "" };
		});
		const FRONT_LABELS = { react: "React", vue: "Vue", uniapp: "uni-app" };
		const BACK_LABELS = { node: "Node.js", springboot: "Spring Boot" };
		const APPTYPE_LABELS = { web: "Web 应用", internal: "内部工具", miniapp: "微信小程序", mobile: "移动端", desktop: "桌面端" };
		const findTpl = (parsed, front, back) => parsed.find((t) => t.front === front && t.back === back);

		/**
		 * 共享「新建项目」表单（UI 统一铁律：全部用官方 primitives）。
		 * mode=create：项目名称 + 前端技术栈 + 后端技术栈 + 应用类型（模板创建）
		 * mode=git：   项目名称 + Git 地址（POST /api/projects/import-git，SSE 流式）
		 * mode=upload：项目名称 + zip 文件（POST /api/projects/import-zip，SSE 流式）
		 */
		const consumeSSE = async (resp, onEvent) => {
			const reader = resp.body.getReader();
			const dec = new TextDecoder();
			let buf = "";
			let project = null;
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += dec.decode(value, { stream: true });
				const lines = buf.split("\n");
				buf = lines.pop() || "";
				for (const line of lines) {
					const t = line.trim();
					if (!t.startsWith("data:")) continue;
					let evt;
					try { evt = JSON.parse(t.slice(5).trim()); } catch { continue; }
					if (evt && onEvent) onEvent(evt);
					if (evt && evt.type === "done" && evt.project) project = evt.project;
					if (evt && evt.type === "error") { try { await reader.cancel(); } catch { /* ignore */ } throw new Error(evt.error || "导入失败"); }
					if (project) { try { await reader.cancel(); } catch { /* ignore */ } return project; }
				}
			}
			return project;
		};
