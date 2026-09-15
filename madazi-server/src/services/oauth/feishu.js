// 飞书 OAuth2（自建应用网页授权）
// 授权：accounts.feishu.cn authen/v1/authorize（app_id+redirect_uri+state）
// 换 token：authen/v1/oidc/access_token（OIDC code→token，需权限 authen:user.oidc:read）
// userinfo：authen/v1/userinfo（Bearer token → open_id/union_id/name/avatar/mobile）
// 注意：provider_user_id 用 open_id（应用内唯一）；union_id 可用于跨应用识别同一人。

import { OAuthProvider } from './base.js';

export class FeishuProvider extends OAuthProvider {
  constructor() {
    super('feishu');
  }

  buildAuthUrl(state, redirectUri, cfg) {
    const q = new URLSearchParams({
      app_id: cfg.appId,
      redirect_uri: redirectUri,
      state,
    });
    return `https://accounts.feishu.cn/open-apis/authen/v1/authorize?${q}`;
  }

  async exchangeToken(code, redirectUri, cfg) {
    const data = await this.httpJson('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: cfg.appId,
        app_secret: cfg.secret,
        code,
        grant_type: 'authorization_code',
      }),
    });
    if (!data || data.code !== 0) {
      throw new Error('[oauth:feishu] 换 token 失败: ' + ((data && data.msg) || 'unknown'));
    }
    return { accessToken: data.data.access_token, extra: {} };
  }

  async fetchProfile(accessToken, extra, cfg) {
    const data = await this.httpJson('https://open.feishu.cn/open-apis/authen/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!data || data.code !== 0) {
      throw new Error('[oauth:feishu] 拉用户信息失败: ' + ((data && data.msg) || 'unknown'));
    }
    const u = data.data || {};
    return this.normalizeProfile({
      id: u.open_id,
      unionId: u.union_id || null,
      name: u.name || u.en_name || '',
      avatar: u.avatar_url || u.avatar_big || '',
      mobile: u.mobile || '',
    });
  }
}
