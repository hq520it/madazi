// 企业微信 OAuth2（扫码授权登录）
// 授权：wwopen/sso/qrConnect（corpid+agentid+redirect_uri+state）
// 换身份：corpid+secret → 全局 access_token → auth/getuserinfo(code) → 企业内 UserId
// profile：user/get(userid) 拉昵称/头像/手机（需通讯录权限；无权限时用 UserId 兜底可登录）
// 注意：企微的 provider_user_id 是「企业成员 ID」，同企业内唯一；openid 是应用级匿名 ID。

import { OAuthProvider } from './base.js';

export class WecomProvider extends OAuthProvider {
  constructor() {
    super('wecom');
  }

  buildAuthUrl(state, redirectUri, cfg) {
    const q = new URLSearchParams({
      appid: cfg.appId,
      agentid: String(cfg.agentId || ''),
      redirect_uri: redirectUri,
      state,
    });
    return `https://open.work.weixin.qq.com/wwopen/sso/qrConnect?${q}`;
  }

  async exchangeToken(code, redirectUri, cfg) {
    // ① corpid+corpsecret 换全局 access_token
    const tok = await this.httpJson(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(cfg.appId)}&corpsecret=${encodeURIComponent(cfg.secret)}`
    );
    if (!tok || tok.errcode) {
      throw new Error('[oauth:wecom] gettoken 失败: ' + ((tok && tok.errmsg) || tok.errcode));
    }
    // ② 授权 code 换成员身份（企业内 UserId）
    const info = await this.httpJson(
      `https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${encodeURIComponent(tok.access_token)}&code=${encodeURIComponent(code)}`
    );
    if (!info || info.errcode) {
      throw new Error('[oauth:wecom] getuserinfo 失败: ' + ((info && info.errmsg) || info.errcode));
    }
    return { accessToken: tok.access_token, extra: { userid: info.userid, openid: info.openid } };
  }

  async fetchProfile(accessToken, extra, cfg) {
    if (!extra.userid) {
      throw new Error('[oauth:wecom] 未拿到企业成员 UserId');
    }
    // ③ 通讯录详情（昵称/头像/手机）；无权限时 errcode=60011 等 → 用 UserId 兜底
    const user = await this.httpJson(
      `https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${encodeURIComponent(accessToken)}&userid=${encodeURIComponent(extra.userid)}`
    ).catch(() => null);
    if (user && !user.errcode) {
      return this.normalizeProfile({
        id: extra.userid,
        unionId: user.unionid || extra.openid,
        name: user.name || extra.userid,
        avatar: user.avatar || '',
        mobile: user.mobile || '',
      });
    }
    return this.normalizeProfile({
      id: extra.userid,
      unionId: extra.openid || extra.userid,
      name: extra.userid,
      avatar: '',
      mobile: '',
    });
  }
}
