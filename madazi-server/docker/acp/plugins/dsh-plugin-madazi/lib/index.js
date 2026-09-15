import { TypertRemoteService, Remote } from "@deepseek-ai/dsh-typert-protocol";
import z from "@deepseek-ai/schemastery";

/**
 * MadaziBridge — node half of the madazi platform plugin.
 * Exposes the madazi platform API to the official UI client as ctx.remote.madazi.*
 *
 * Remote markers are applied manually (the @Remote decorator is a TS-compile-time
 * construct; we emulate its context.addInitializer contract at runtime).
 */
const pendingMarks = [];
function markRemote(name) {
	// Remote("name") string overload returns a decorator; emulate the TS
	// __esDecorate invocation to collect its initializers, then run them
	// against a prototype-only stand-in so markers land before any instance.
	const decorator = Remote(name);
	const initializers = [];
	const fakeCtx = {
		kind: "method",
		name,
		static: false,
		private: false,
		access: { has: (o) => name in o, get: (o) => o[name] },
		addInitializer(fn) { initializers.push(fn); }
	};
	decorator(undefined, fakeCtx);
	for (const fn of initializers) fn.call(Object.create(MadaziBridge.prototype));
}

/** Module-level helper: avoids private members (the gateway receiver is a
 * cordis proxy; private methods throw "Receiver must be an instance of class"). */
async function apiRequest(apiBase, token, path, options = {}) {
	const headers = { "Content-Type": "application/json" };
	if (token) headers.Authorization = `Bearer ${token}`;
	const r = await fetch(`${apiBase}${path}`, { method: options.method || "GET", headers, body: options.body });
	if (!r.ok) {
		const body = await r.text().catch(() => "");
		throw new Error(`madazi api ${path} -> ${r.status} ${body.slice(0, 160)}`);
	}
	return r.json();
}

class MadaziBridge extends TypertRemoteService {
	static Config = z.object({
		apiBase: z.string().default("http://madazi-server:3456"),
		token: z.string().default("")
	});

	constructor(ctx, config = {}) {
		super(ctx, "madazi");
		// ★ apiBase/token 走环境变量优先（Dockerfile/deployment 模板注入，插件 config 兜底）
		//   生产 apiBase = madazi-server Service DNS（web pod 内 127.0.0.1 无服务，曾致 fetch failed）
		this.apiBase = process.env.MADAZI_API_BASE || config.apiBase || "http://madazi-server:3456";
		this.token = process.env.MADAZI_SVC_TOKEN || config.token || "";
		console.error("[madazi-bridge] constructed; ns:", this.typertRemote && this.typertRemote.namespace, "apiBase:", this.apiBase, "token:", this.token ? "set(" + this.token.length + ")" : "none");
		// S2-3: 工作区列表显示项目名（workspace title 默认 = path basename = uuid）。
		// 启动延迟同步（等 cordis service 全就绪 + generated 目录挂载）+ 60s 周期兜底。
		// 周期兜底必要性：启动同步时项目目录可能尚未注册为 workspace（resolveByPath 落空），
		// 用户随后经「添加工作区」流打开时 workspace 才被创建（title=uuid）——若无周期任务，
		// 直到 pod 重启前都显示 uuid（client 半 startWorkspaceTitleWatch 为第一道防线）。
		setTimeout(() => this.syncWorkspaceTitles().catch(() => {}), 5000);
		this._titleSyncTimer = setInterval(() => {
			if (this._titleSyncBusy) return;
			this._titleSyncBusy = true;
			this.syncWorkspaceTitles().catch(() => {}).finally(() => { this._titleSyncBusy = false; });
		}, 60000);
	}

	// S2-3: 把 /app/generated/<id> 的 workspace title 同步为平台项目名。
	// ★ 只修 uuid 形默认标题（basename 兜底产物），用户手动改名永不覆盖。
	async syncWorkspaceTitles() {
		try {
			// ★ 部署形态兼容：k8s=容器内 /app/generated（web pod 与 server 共享 PVC）；
			//   单机版=注入的 MADAZI_PROJECTS_ROOT（start.sh 传 PROJECTS_ROOT）
			const dir = process.env.MADAZI_PROJECTS_ROOT || "/app/generated";
			const resp = await apiRequest(this.apiBase, this.token, "/api/projects");
			const projects = Array.isArray(resp) ? resp : (resp && resp.projects) || [];
			const byId = new Map(projects.map((p) => [p.id, p.name]));
			if (!byId.size) { console.error("[madazi-bridge] syncWorkspaceTitles: no projects from api"); return; }
			const fs = await import("node:fs");
			const ids = fs.readdirSync(dir).filter((id) => byId.has(id));
			const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
			let synced = 0;
			for (const id of ids) {
				try {
					// node 半无 inject 声明：用 ctx.get 动态获取（service 注册名 workspaceRegistry）
					const wsvc = (this.ctx.get && this.ctx.get("workspaceRegistry")) || this.ctx.workspaces;
					const ws = await wsvc.resolveByPath(`${dir}/${id}`);
					if (ws && UUID_RE.test(ws.title || "")) { await ws.setTitle(byId.get(id)); synced++; }
				} catch (e) { console.error(`[madazi-bridge] ws sync fail ${id}:`, String((e && e.message) || e)); }
			}
			if (synced) console.error(`[madazi-bridge] workspace titles synced: ${synced}/${ids.length}`);
		} catch (e) {
			console.error("[madazi-bridge] syncWorkspaceTitles failed:", String((e && e.message) || e));
		}
	}

	// S3 hero 区项目信息行：workspaceId → {id, path, title}（client 半由 path 推导 /app/generated/<项目id>）
	async resolveWorkspace(workspaceId) {
		try {
			const wsvc = (this.ctx.get && this.ctx.get("workspaceRegistry")) || this.ctx.workspaces;
			const ws = wsvc && wsvc.get ? wsvc.get(workspaceId) : null;
			if (!ws) return { ok: false, error: "workspace not found: " + workspaceId };
			return { ok: true, value: { id: ws.id, path: ws.path, title: ws.title } };
		} catch (e) {
			return { ok: false, error: String((e && e.message) || e) };
		}
	}

	async listProjects() {
		return apiRequest(this.apiBase, this.token, "/api/projects");
	}

	async getProject(id) {
		return apiRequest(this.apiBase, this.token, `/api/projects/${id}`);
	}

	async listTasks(projectId) {
		return apiRequest(this.apiBase, this.token, `/api/projects/${projectId}/chat/tasks`);
	}

	async cancelTask(projectId, taskId) {
		return apiRequest(this.apiBase, this.token, `/api/projects/${projectId}/chat/tasks/${taskId}/cancel`, { method: "POST" });
	}

	async previewStatus(projectId) {
		return apiRequest(this.apiBase, this.token, `/api/projects/${projectId}/preview/status`);
	}

	async previewStart(projectId) {
		return apiRequest(this.apiBase, this.token, `/api/projects/${projectId}/preview/start`, { method: "POST" });
	}

	async previewStop(projectId) {
		return apiRequest(this.apiBase, this.token, `/api/projects/${projectId}/preview/stop`, { method: "POST" });
	}

	async previewRestart(projectId) {
		return apiRequest(this.apiBase, this.token, `/api/projects/${projectId}/preview/restart`, { method: "POST" });
	}

	async previewHardRestart(projectId) {
		return apiRequest(this.apiBase, this.token, `/api/projects/${projectId}/preview/hard-restart`, { method: "POST" });
	}

	async listRunningPreviews() {
		return apiRequest(this.apiBase, this.token, `/api/projects/previews/running`);
	}

	async previewLogs(projectId, tail = 300000) {
		// ★ WS 日志流：订阅 server 推送（含构建段+启动+运行全量 stdout），前端 RPC 拉本地缓存
		console.error('[bridge] previewLogs called', projectId, 'tail', tail);
		if (!this._logBufs) this._logBufs = new Map();
		if (!this._logWsMap) this._logWsMap = new Map();
		if (!this._logWsMap.has(projectId)) this._logWsMap.set(projectId, this._openPreviewLogWs(projectId));
		const buf = this._logBufs.get(projectId) || '';
		console.error('[bridge] previewLogs returns buf len', buf.length);
		return { ok: true, value: { logs: buf.slice(-tail) } };
	}

	_openPreviewLogWs(projectId) {
		const wsUrl = `${this.apiBase.replace(/^http/, 'ws')}/api/ws/preview-log?projectId=${encodeURIComponent(projectId)}&token=${encodeURIComponent(this.token)}`;
		console.error('[bridge] previewLog WS connecting', wsUrl.replace(/token=[^&]+/, 'token=***'));
		let ws = null;
		try { ws = new WebSocket(wsUrl); } catch (err) { console.error('[bridge] previewLog WS ctor error', err.message); return null; }
		ws.onopen = () => console.error('[bridge] previewLog WS OPEN', projectId);
		ws.onmessage = (ev) => {
			try {
				const m = JSON.parse(ev.data);
				if (m.type === 'log' && m.text) {
					// ★ reset=true：日志重置（重启/重建）→ 清缓存存全量，避免旧日志残留
					if (m.reset) {
						this._logBufs.set(projectId, m.text.slice(-300000));
					} else {
						const prev = this._logBufs.get(projectId) || '';
						this._logBufs.set(projectId, (prev + m.text).slice(-300000));
					}
					console.error('[bridge] previewLog WS recv', projectId, 'text len', m.text.length, 'reset', !!m.reset, 'buf', this._logBufs.get(projectId).length);
				}
			} catch { /* ignore */ }
		};
		ws.onclose = (e) => { console.error('[bridge] previewLog WS CLOSE', projectId, e.code); this._logWsMap.delete(projectId); };
		ws.onerror = () => { console.error('[bridge] previewLog WS ERROR', projectId); try { ws.close(); } catch {} this._logWsMap.delete(projectId); };
		return ws;
	}

	async listTemplates() {
		return apiRequest(this.apiBase, this.token, "/api/templates");
	}

	async createProject(payload) {
		console.error("[madazi-bridge] createProject payload:", typeof payload, JSON.stringify(payload));
		return apiRequest(this.apiBase, this.token, "/api/projects", { method: "POST", body: JSON.stringify(payload) });
	}

	async getMe() {
		return apiRequest(this.apiBase, this.token, "/api/auth/me");
	}

	async listKeys() {
		return apiRequest(this.apiBase, this.token, "/api/keys");
	}

	async createKey(payload) {
		return apiRequest(this.apiBase, this.token, "/api/keys", { method: "POST", body: JSON.stringify(payload || {}) });
	}

	async revokeKey(id) {
		return apiRequest(this.apiBase, this.token, `/api/keys/${id}`, { method: "DELETE" });
	}

	async usageSummary() {
		return apiRequest(this.apiBase, this.token, "/api/keys/usage/summary");
	}

	// ── admin 分节（最小版：用户 + key 管理）──────────────
	async listUsers() {
		return apiRequest(this.apiBase, this.token, "/api/admin/users");
	}

	async createUser(payload) {
		return apiRequest(this.apiBase, this.token, "/api/admin/users", { method: "POST", body: JSON.stringify(payload) });
	}

	async deleteUser(id) {
		return apiRequest(this.apiBase, this.token, `/api/admin/users/${id}`, { method: "DELETE" });
	}

	async updateUserRole(id, role) {
		return apiRequest(this.apiBase, this.token, `/api/admin/users/${id}/role`, { method: "PUT", body: JSON.stringify({ role }) });
	}

	async listAllKeys() {
		return apiRequest(this.apiBase, this.token, "/api/keys/all");
	}

	// ── 阶段 3 多人协同：项目组成员管理（后端 routes/members.js 全套已有）────────
	async listProjectMembers(projectId) {
		return apiRequest(this.apiBase, this.token, `/api/projects/${projectId}/members`);
	}

	async searchProjectMembers(projectId, q) {
		return apiRequest(this.apiBase, this.token, `/api/projects/${projectId}/members/search?q=${encodeURIComponent(q || "")}`);
	}

	async addProjectMember(projectId, payload) {
		return apiRequest(this.apiBase, this.token, `/api/projects/${projectId}/members`, { method: "POST", body: JSON.stringify(payload) });
	}

	async removeProjectMember(projectId, userId) {
		return apiRequest(this.apiBase, this.token, `/api/projects/${projectId}/members/${userId}`, { method: "DELETE" });
	}

	async setProjectMemberRole(projectId, userId, role) {
		return apiRequest(this.apiBase, this.token, `/api/projects/${projectId}/members/${userId}`, {
			method: "PUT",
			body: JSON.stringify({ role }),
			headers: { "Content-Type": "application/json" },
		});
	}

	// S3 实时同步：项目在线成员（project-ws presence 的 HTTP 快照）
	async getProjectOnlineUsers(projectId) {
		return apiRequest(this.apiBase, this.token, `/api/projects/${projectId}/online`);
	}

	// ── 插件市场一键安装：执行 dsh plugin --profile web add <repo>（PVC profiles/web 目录）────
	// repo 来自市场数据 r 字段（GitHub owner/repo 或 npm 包名），白名单正则防命令注入。
	async pluginInstall(repo) {
		if (!repo || typeof repo !== "string" || !/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?$/.test(repo)) {
			return { ok: false, error: "invalid repo: " + String(repo).slice(0, 80) };
		}
		const { execFile } = await import("node:child_process");
		try {
			const out = await new Promise((resolve, reject) => {
				execFile("dsh", ["plugin", "--profile", "web", "add", repo], {
					cwd: "/app/generated/.dsh/profiles/web",
					timeout: 420000,
					maxBuffer: 4 * 1024 * 1024
				}, (err, stdout, stderr) => {
					if (err) reject(err);
					else resolve((stdout || "") + (stderr || ""));
				});
			});
			return { ok: true, output: String(out).slice(-2000) };
		} catch (e) {
			return { ok: false, error: String((e && e.stderr) || (e && e.message) || e).slice(-2000) };
		}
	}

	// ── S7 插件市场（madazi-server /api/admin/plugins：npmmirror 搜索/预检/安装自动回滚/启停/日志）────
	async marketList() {
		return apiRequest(this.apiBase, this.token, "/api/admin/plugins");
	}

	async marketSearch(q) {
		return apiRequest(this.apiBase, this.token, `/api/admin/plugins/search?q=${encodeURIComponent(String(q || ""))}`);
	}

	async marketPrecheck(name) {
		return apiRequest(this.apiBase, this.token, `/api/admin/plugins/precheck?name=${encodeURIComponent(String(name || ""))}`);
	}

	async marketInstall(name, version) {
		const body = { name };
		if (version) body.version = version;
		return apiRequest(this.apiBase, this.token, "/api/admin/plugins/install", { method: "POST", body: JSON.stringify(body) });
	}

	async marketUninstall(name) {
		return apiRequest(this.apiBase, this.token, "/api/admin/plugins/uninstall", { method: "POST", body: JSON.stringify({ name }) });
	}

	async marketToggle(name, enable) {
		return apiRequest(this.apiBase, this.token, `/api/admin/plugins/${enable ? "enable" : "disable"}`, { method: "POST", body: JSON.stringify({ name }) });
	}

	async marketLogs(task) {
		return apiRequest(this.apiBase, this.token, `/api/admin/plugins/logs?task=${encodeURIComponent(String(task || ""))}`);
	}
}

markRemote("listProjects");
markRemote("getProject");
markRemote("resolveWorkspace");
markRemote("listTasks");
markRemote("cancelTask");
markRemote("previewStatus");
markRemote("previewStart");
markRemote("previewStop");
markRemote("previewRestart");
markRemote("previewHardRestart");
markRemote("listRunningPreviews");
markRemote("previewLogs");
markRemote("listTemplates");
markRemote("createProject");
markRemote("getMe");
markRemote("listKeys");
markRemote("createKey");
markRemote("revokeKey");
markRemote("usageSummary");
markRemote("listUsers");
markRemote("createUser");
markRemote("deleteUser");
markRemote("updateUserRole");
markRemote("listAllKeys");
markRemote("listProjectMembers");
markRemote("searchProjectMembers");
markRemote("addProjectMember");
markRemote("removeProjectMember");
markRemote("setProjectMemberRole");
markRemote("getProjectOnlineUsers");
markRemote("pluginInstall");
markRemote("marketList");
markRemote("marketSearch");
markRemote("marketPrecheck");
markRemote("marketInstall");
markRemote("marketUninstall");
markRemote("marketToggle");
markRemote("marketLogs");
console.error("[madazi-bridge] module loaded; remote methods marked");

export default MadaziBridge;
