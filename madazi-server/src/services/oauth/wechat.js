// 微信登录（微信开放平台「网站应用」扫码登录）
// 授权：open.weixin.qq.com/connect/qrconnect（appid + redirect_uri + scope=snsapi_login + state）
// 换 token：api.weixin.qq.com/sns/oauth2/access_token（appid+secret+code → access_token+openid）
// userinfo：api.weixin.qq.com/sns/userinfo（access_token+openid → nickname/headimgurl/unionid）
// 注意：provider_user_id 用 openid（应用级唯一）；unionid 需开放平台绑定公众号/小程序后才有，
//   未绑定时为 null，不影响建号/登录。微信无手机号返回。

import { OAuthProvider } from './base.js';

export class WechatProvider extends OAuthProvider {
  constructor() {
    super('wechat');
  }

  buildAuthUrl(state, redirectUri, cfg) {
    const q = new URLSearchParams({
      appid: cfg.appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'snsapi_login',
      state,
    });
    return `https://open.weixin.qq.com/connect/qrconnect?${q}#wechat_redirect`;
  }

  async exchangeToken(code, redirectUri, cfg) {
    const q = new URLSearchParams({
      appid: cfg.appId,
      secret: cfg.secret,
      code,
      grant_type: 'authorization_code',
    });
    const data = await this.httpJson(`https://api.weixin.qq.com/sns/oauth2/access_token?${q}`);
    if (!data || data.errcode) {
      throw new Error('[oauth:wechat] 换 token 失败: ' + ((data && data.errmsg) || data.errcode));
    }
    return { accessToken: data.access_token, extra: { openid: data.openid, unionid: data.unionid || null } };
  }

  async fetchProfile(accessToken, extra, cfg) {
    if (!extra.openid) {
      throw new Error('[oauth:wechat] 未拿到微信 openid');
    }
    const q = new URLSearchParams({
      access_token: accessToken,
      openid: extra.openid,
      lang: 'zh_CN',
    });
    const u = await this.httpJson(`https://api.weixin.qq.com/sns/userinfo?${q}`);
    if (!u || u.errcode) {
      // 用户信息拉取失败（如未授权 snsapi_userinfo）→ 用 openid 兜底，仍可登录
      return this.normalizeProfile({
        id: extra.openid,
        unionId: extra.unionid,
        name: '',
        avatar: '',
        mobile: '',
      });
    }
    return this.normalizeProfile({
      id: u.openid || extra.openid,
      unionId: u.unionid || extra.unionid || null,
      name: u.nickname || '',
      avatar: u.headimgurl || '',
      mobile: '',
    });
  }
}
