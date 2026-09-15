// dsh-plugin-login node 半：仅占位（client 半自持状态，无平台 RPC）。
// 保留与 hello 插件相同的模块形状，避免 dsh 加载器对缺 node 半的包处理路径不同。
export default class MadaziLoginBridge {
	constructor() {
		// 无平台 API 依赖：登录态完全由浏览器 cookie + 平台 server 鉴权中间件承载
	}
}
