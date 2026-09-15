// OAuth2 provider 基类（2026-08-28 三方登录）
// 企业微信 / 飞书 / 钉钉 共用授权码（authorization code）流程模板。
// 每家子类实现三步：buildAuthUrl（带 state 防 CSRF）→ exchangeToken（code→access_token）
// → fetchProfile（token→统一 profile { id, unionId, name, avatar, mobile }）。
// 配置一律来自 settings 表（oauth_<name> JSON，secret 走 keycrypto 加密），见 index.js loadConfig。

export class OAuthProvider {
  constructor(name) {
    this.name = name; // 'wecom' | 'feishu' | 'dingtalk'
  }

  // 生成授权 URL（redirectUri 为平台回调地址，state 为防 CSRF 随机串）
  buildAuthUrl(state, redirectUri, cfg) {
    throw new Error(`[oauth:${this.name}] buildAuthUrl not implemented`);
  }

  // code → access_token（返回原始响应 JSON）
  async exchangeToken(code, redirectUri, cfg) {
    throw new Error(`[oauth:${this.name}] exchangeToken not implemented`);
  }

  // access_token → 统一 profile
  async fetchProfile(accessToken, cfg) {
    throw new Error(`[oauth:${this.name}] fetchProfile not implemented`);
  }

  // 归一化 profile：各家字段差异在此收敛（子类可覆写）
  normalizeProfile(raw) {
    return {
      id: raw.id || null,
      unionId: raw.unionId || null,
      name: raw.name || '',
      avatar: raw.avatar || '',
      mobile: raw.mobile || '',
      raw,
    };
  }

  // 统一的带超时 fetch（三方接口偶发慢，防挂住回调）
  async httpJson(url, opts = {}, timeoutMs = 10000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { /* 非 JSON 响应 */ }
      if (!res.ok) {
        const err = new Error(`[oauth:${this.name}] HTTP ${res.status}: ${text.slice(0, 300)}`);
        err.status = res.status;
        err.body = data;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
}
