// 钉钉 OAuth2（新版扫码登录第三方网站）
// 授权：login.dingtalk.com/oauth2/auth（client_id=appKey + redirect_uri + state + scope=openid）
// 换 token：api.dingtalk.com v1.0/oauth2/userAccessToken（clientId/clientSecret/code）
// userinfo：api.dingtalk.com v1.0/contact/users/me（x-acs-dingtalk-access-token 头）
// 注意：provider_user_id 用 unionId（钉钉全局唯一，跨应用稳定）。

import { OAuthProvider } from './base.js';

export class DingtalkProvider extends OAuthProvider {
  constructor() {
    super('dingtalk');
  }

  buildAuthUrl(state, redirectUri, cfg) {
    const q = new URLSearchParams({
      redirect_uri: redirectUri,
      response_type: 'code',
      client_id: cfg.appId,
      scope: 'openid',
      state,
      prompt: 'consent',
    });
    return `https://login.dingtalk.com/oauth2/auth?${q}`;
  }

  async exchangeToken(code, redirectUri, cfg) {
    const data = await this.httpJson('https://api.dingtalk.com/v1.0/oauth2/userAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: cfg.appId,
        clientSecret: cfg.secret,
        code,
        grantType: 'authorization_code',
      }),
    });
    if (!data || !data.accessToken) {
      throw new Error('[oauth:dingtalk] 换 token 失败');
    }
    return { accessToken: data.accessToken, extra: {} };
  }

  async fetchProfile(accessToken, extra, cfg) {
    const data = await this.httpJson('https://api.dingtalk.com/v1.0/contact/users/me', {
      headers: { 'x-acs-dingtalk-access-token': accessToken },
    });
    if (!data || !data.unionId) {
      throw new Error('[oauth:dingtalk] 拉用户信息失败');
    }
    return this.normalizeProfile({
      id: data.unionId,
      unionId: data.unionId,
      name: data.nick || data.nickname || '',
      avatar: data.avatarUrl || data.avatar || '',
      mobile: data.mobile || '',
    });
  }
}
