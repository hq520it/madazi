/** Host-face Typert manifest for @madazi/dsh-plugin-madazi.
 * Registered into ctx.typert by dsh-typert-loader when the plugin entry mounts
 * (package.json exports["./typert"]), which makes the gateway serve
 * madazi.* endpoints and lets the client resolve ctx.remote.madazi.
 */
import { z } from "zod";

const listProjectsResultSchema = z.array(z.any()).default([]);
const listResultSchema = z.array(z.any()).default([]);
const anyResultSchema = z.any();

const ID = "@madazi/dsh-plugin-madazi#madazi/";

export const TYPERT = {
	package: "@madazi/dsh-plugin-madazi",
	face: "host",
	schemas: [],
	invocations: [
		{
			id: ID + "listProjects",
			service: "madazi",
			namespace: "madazi",
			method: "listProjects",
			invocation: { kind: "direct" },
			parameters: [],
			result: {
				mode: "strict",
				typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectList",
				schema: listProjectsResultSchema
			}
		},
		{
			id: ID + "getProject",
			service: "madazi",
			namespace: "madazi",
			method: "getProject",
			invocation: { kind: "direct" },
			parameters: [{
				name: "id",
				wire: "id",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: z.any() }
			}],
			result: {
				mode: "strict",
				typeSymbol: "@madazi/dsh-plugin-madazi/client#Project",
				schema: anyResultSchema
			}
		},
		{
			id: ID + "listTasks",
			service: "madazi",
			namespace: "madazi",
			method: "listTasks",
			invocation: { kind: "direct" },
			parameters: [{
				name: "projectId",
				wire: "projectId",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: z.any() }
			}],
			result: {
				mode: "strict",
				typeSymbol: "@madazi/dsh-plugin-madazi/client#TaskList",
				schema: listResultSchema
			}
		},
		{
			id: ID + "cancelTask",
			service: "madazi",
			namespace: "madazi",
			method: "cancelTask",
			invocation: { kind: "direct" },
			parameters: [{
				name: "projectId",
				wire: "projectId",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: z.any() }
			}, {
				name: "taskId",
				wire: "taskId",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#TaskId", schema: z.any() }
			}],
			result: {
				mode: "strict",
				typeSymbol: "@madazi/dsh-plugin-madazi/client#CancelResult",
				schema: anyResultSchema
			}
		},
		{
			id: ID + "listTemplates",
			service: "madazi",
			namespace: "madazi",
			method: "listTemplates",
			invocation: { kind: "direct" },
			parameters: [],
			result: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#TemplateList", schema: listResultSchema }
		},
		{
			id: ID + "createProject",
			service: "madazi",
			namespace: "madazi",
			method: "createProject",
			invocation: { kind: "direct" },
			parameters: [{
				name: "payload",
				wire: "payload",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#CreateProjectPayload", schema: z.any() }
			}],
			result: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#Project", schema: anyResultSchema }
		},
		{
			id: ID + "getMe",
			service: "madazi",
			namespace: "madazi",
			method: "getMe",
			invocation: { kind: "direct" },
			parameters: [],
			result: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#Me", schema: anyResultSchema }
		},
		{
			id: ID + "listKeys",
			service: "madazi",
			namespace: "madazi",
			method: "listKeys",
			invocation: { kind: "direct" },
			parameters: [],
			result: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#KeyList", schema: listResultSchema }
		},
		{
			id: ID + "createKey",
			service: "madazi",
			namespace: "madazi",
			method: "createKey",
			invocation: { kind: "direct" },
			parameters: [{
				name: "payload",
				wire: "payload",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#CreateKeyPayload", schema: z.any() }
			}],
			result: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#Key", schema: anyResultSchema }
		},
		{
			id: ID + "revokeKey",
			service: "madazi",
			namespace: "madazi",
			method: "revokeKey",
			invocation: { kind: "direct" },
			parameters: [{
				name: "id",
				wire: "id",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#KeyId", schema: z.any() }
			}],
			result: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#RevokeResult", schema: anyResultSchema }
		},
		{
			id: ID + "usageSummary",
			service: "madazi",
			namespace: "madazi",
			method: "usageSummary",
			invocation: { kind: "direct" },
			parameters: [],
			result: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#UsageSummary", schema: anyResultSchema }
		},
		{
			id: ID + "listUsers",
			service: "madazi",
			namespace: "madazi",
			method: "listUsers",
			invocation: { kind: "direct" },
			parameters: [],
			result: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#UserList", schema: listResultSchema }
		},
		{
			id: ID + "createUser",
			service: "madazi",
			namespace: "madazi",
			method: "createUser",
			invocation: { kind: "direct" },
			parameters: [{
				name: "payload",
				wire: "payload",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#CreateUserPayload", schema: z.any() }
			}],
			result: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#User", schema: anyResultSchema }
		},
		{
			id: ID + "deleteUser",
			service: "madazi",
			namespace: "madazi",
			method: "deleteUser",
			invocation: { kind: "direct" },
			parameters: [{
				name: "id",
				wire: "id",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#UserId", schema: z.any() }
			}],
			result: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#DeleteResult", schema: anyResultSchema }
		},
		{
			id: ID + "updateUserRole",
			service: "madazi",
			namespace: "madazi",
			method: "updateUserRole",
			invocation: { kind: "direct" },
			parameters: [{
				name: "id",
				wire: "id",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#UserId", schema: z.any() }
			}, {
				name: "role",
				wire: "role",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#Role", schema: z.any() }
			}],
			result: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#User", schema: anyResultSchema }
		},
		{
			id: ID + "listAllKeys",
			service: "madazi",
			namespace: "madazi",
			method: "listAllKeys",
			invocation: { kind: "direct" },
			parameters: [],
			result: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#KeyList", schema: listResultSchema }
		},
		{
			id: ID + "listProjectMembers",
			service: "madazi",
			namespace: "madazi",
			method: "listProjectMembers",
			invocation: { kind: "direct" },
			parameters: [{
				name: "projectId",
				wire: "projectId",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: z.any() }
			}],
			result: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#MemberList", schema: listResultSchema }
		},
		{
			id: ID + "searchProjectMembers",
			service: "madazi",
			namespace: "madazi",
			method: "searchProjectMembers",
			invocation: { kind: "direct" },
			parameters: [{
				name: "projectId",
				wire: "projectId",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: z.any() }
			}, {
				name: "q",
				wire: "q",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#SearchQ", schema: z.any() }
			}],
			result: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#UserList", schema: listResultSchema }
		},
		{
			id: ID + "addProjectMember",
			service: "madazi",
			namespace: "madazi",
			method: "addProjectMember",
			invocation: { kind: "direct" },
			parameters: [{
				name: "projectId",
				wire: "projectId",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: z.any() }
			}, {
				name: "payload",
				wire: "payload",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#AddMemberPayload", schema: z.any() }
			}],
			result: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#Member", schema: anyResultSchema }
		},
		{
			id: ID + "removeProjectMember",
			service: "madazi",
			namespace: "madazi",
			method: "removeProjectMember",
			invocation: { kind: "direct" },
			parameters: [{
				name: "projectId",
				wire: "projectId",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: z.any() }
			}, {
				name: "userId",
				wire: "userId",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#UserId", schema: z.any() }
			}],
			result: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#DeleteResult", schema: anyResultSchema }
		},
		{
			id: ID + "setProjectMemberRole",
			service: "madazi",
			namespace: "madazi",
			method: "setProjectMemberRole",
			invocation: { kind: "direct" },
			parameters: [{
				name: "projectId",
				wire: "projectId",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: z.any() }
			}, {
				name: "userId",
				wire: "userId",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#UserId", schema: z.any() }
			}, {
				name: "role",
				wire: "role",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#Role", schema: z.any() }
			}],
			result: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#Member", schema: anyResultSchema }
		},
		{
			id: ID + "getProjectOnlineUsers",
			service: "madazi",
			namespace: "madazi",
			method: "getProjectOnlineUsers",
			invocation: { kind: "direct" },
			parameters: [{
				name: "projectId",
				wire: "projectId",
				source: "json",
				codec: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#ProjectId", schema: z.any() }
			}],
			result: { mode: "strict", typeSymbol: "@madazi/dsh-plugin-madazi/client#OnlineUsers", schema: anyResultSchema }
		}
	],
	model: { services: [], events: [], objects: [] }
};
