		const NS = "madaziHello";

		// apply(ctx) 时捕获 ctx：factory 顶层组件（CreateProjectForm 等）不在 apply 作用域内
		let _madaziCtx = null;

		/** Client services required by this plugin. */
		const inject = ["slots", "locale", "remote", "sessions", "workspaces"];

		/** Generated Host Remote contribution: mirrors dsh-api-remotes' $mount contract. */
		const TYPERT_REMOTE = {
			package: "@madazi/dsh-plugin-madazi",
			descriptors: [{
				id: "@madazi/dsh-plugin-madazi#madazi/listProjects",
				service: "madazi",
				namespace: "madazi",
				method: "listProjects",
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectList",
					schema: { parse: (v) => v }
				}
			}, {
				id: "@madazi/dsh-plugin-madazi#madazi/getProject",
				service: "madazi",
				namespace: "madazi",
				method: "getProject",
				invocation: { kind: "direct" },
				parameters: [{
					name: "id",
					wire: "id",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#Project",
					schema: { parse: (v) => v }
				}
			}, {
				id: "@madazi/dsh-plugin-madazi#madazi/listTasks",
				service: "madazi",
				namespace: "madazi",
				method: "listTasks",
				invocation: { kind: "direct" },
				parameters: [{
					name: "projectId",
					wire: "projectId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#TaskList",
					schema: { parse: (v) => v }
				}
			}, {
				id: "@madazi/dsh-plugin-madazi#madazi/cancelTask",
				service: "madazi",
				namespace: "madazi",
				method: "cancelTask",
				invocation: { kind: "direct" },
				parameters: [{
					name: "projectId",
					wire: "projectId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: { parse: (v) => v } }
				}, {
					name: "taskId",
					wire: "taskId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#TaskId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#CancelResult",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/previewStatus",
				service: "madazi",
				namespace: "madazi",
				method: "previewStatus",
				invocation: { kind: "direct" },
				parameters: [{
					name: "projectId",
					wire: "projectId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#PreviewStatus",
					schema: { parse: (v) => v }
				}
			}, {
				id: "@madazi/dsh-plugin-madazi#madazi/previewStart",
				service: "madazi",
				namespace: "madazi",
				method: "previewStart",
				invocation: { kind: "direct" },
				parameters: [{
					name: "projectId",
					wire: "projectId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#PreviewStartResult",
					schema: { parse: (v) => v }
				}
			}, {
				id: "@madazi/dsh-plugin-madazi#madazi/previewStop",
				service: "madazi",
				namespace: "madazi",
				method: "previewStop",
				invocation: { kind: "direct" },
				parameters: [{
					name: "projectId",
					wire: "projectId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#PreviewStopResult",
					schema: { parse: (v) => v }
				}
			}, {
				id: "@madazi/dsh-plugin-madazi#madazi/previewRestart",
				service: "madazi",
				namespace: "madazi",
				method: "previewRestart",
				invocation: { kind: "direct" },
				parameters: [{
					name: "projectId",
					wire: "projectId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#PreviewRestartResult",
					schema: { parse: (v) => v }
				}
			}, {
				id: "@madazi/dsh-plugin-madazi#madazi/previewHardRestart",
				service: "madazi",
				namespace: "madazi",
				method: "previewHardRestart",
				invocation: { kind: "direct" },
				parameters: [{
					name: "projectId",
					wire: "projectId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#PreviewRestartResult",
					schema: { parse: (v) => v }
				}
			}, {
				id: "@madazi/dsh-plugin-madazi#madazi/listRunningPreviews",
				service: "madazi",
				namespace: "madazi",
				method: "listRunningPreviews",
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#RunningPreviews",
					schema: { parse: (v) => v }
				}
			}, {
				id: "@madazi/dsh-plugin-madazi#madazi/previewLogs",
				service: "madazi",
				namespace: "madazi",
				method: "previewLogs",
				invocation: { kind: "direct" },
				parameters: [{
					name: "projectId",
					wire: "projectId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#PreviewLogsResult",
					schema: { parse: (v) => v }
				}
			}, {
				id: "@madazi/dsh-plugin-madazi#madazi/listTemplates",
				service: "madazi",
				namespace: "madazi",
				method: "listTemplates",
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#TemplateList",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/createProject",
				service: "madazi",
				namespace: "madazi",
				method: "createProject",
				invocation: { kind: "direct" },
				parameters: [{
					name: "payload",
					wire: "payload",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#CreateProjectPayload", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#Project",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/getMe",
				service: "madazi",
				namespace: "madazi",
				method: "getMe",
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#Me",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/resolveWorkspace",
				service: "madazi",
				namespace: "madazi",
				method: "resolveWorkspace",
				invocation: { kind: "direct" },
				parameters: [{
					name: "workspaceId",
					wire: "workspaceId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#WorkspaceId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#WorkspaceInfo",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/listKeys",
				service: "madazi",
				namespace: "madazi",
				method: "listKeys",
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#KeyList",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/createKey",
				service: "madazi",
				namespace: "madazi",
				method: "createKey",
				invocation: { kind: "direct" },
				parameters: [{
					name: "payload",
					wire: "payload",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#CreateKeyPayload", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#Key",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/revokeKey",
				service: "madazi",
				namespace: "madazi",
				method: "revokeKey",
				invocation: { kind: "direct" },
				parameters: [{
					name: "id",
					wire: "id",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#KeyId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#RevokeResult",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/usageSummary",
				service: "madazi",
				namespace: "madazi",
				method: "usageSummary",
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#UsageSummary",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/listUsers",
				service: "madazi",
				namespace: "madazi",
				method: "listUsers",
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#UserList",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/createUser",
				service: "madazi",
				namespace: "madazi",
				method: "createUser",
				invocation: { kind: "direct" },
				parameters: [{
					name: "payload",
					wire: "payload",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#CreateUserPayload", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#User",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/deleteUser",
				service: "madazi",
				namespace: "madazi",
				method: "deleteUser",
				invocation: { kind: "direct" },
				parameters: [{
					name: "id",
					wire: "id",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#UserId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#DeleteResult",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/updateUserRole",
				service: "madazi",
				namespace: "madazi",
				method: "updateUserRole",
				invocation: { kind: "direct" },
				parameters: [{
					name: "id",
					wire: "id",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#UserId", schema: { parse: (v) => v } }
				}, {
					name: "role",
					wire: "role",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#Role", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#User",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/listAllKeys",
				service: "madazi",
				namespace: "madazi",
				method: "listAllKeys",
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#KeyList",
					schema: { parse: (v) => v }
				}
				}, {
				id: "@madazi/dsh-plugin-madazi#madazi/getProjectOnlineUsers",
				service: "madazi",
				namespace: "madazi",
				method: "getProjectOnlineUsers",
				invocation: { kind: "direct" },
				parameters: [{
					name: "projectId",
					wire: "projectId",
					source: "json",
					codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: { parse: (v) => v } }
				}],
				result: {
					mode: "strict",
					typeSymbol: "@madazi/dsh-plugin-madazi/client#OnlineUsers",
					schema: { parse: (v) => v }
				}
				}]
				};
