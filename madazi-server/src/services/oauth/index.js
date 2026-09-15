// OAuth 统一入口（2026-08-28 三方登录）
// 注册表 + 配置读取（settings 表 oauth_<name> JSON，secret 走 keycrypto 解密）+ 登录交换统一出口。
// 登录流程：路由层生成 state → buildAuthUrl → 用户扫码授权 → 回调带 code → oauthExchange 归一化 profile。

import { getSetting } from '../settings.js';
import { decryptKey } from '../keycrypto.js';
import { WechatProvider } from './wechat.js';
import { WecomProvider } from './wecom.js';
import { FeishuProvider } from './feishu.js';
import { DingtalkProvider } from './dingtalk.js';

export const OAUTH_PROVIDERS = ['wechat', 'wecom', 'feishu', 'dingtalk'];

const registry = {
  wechat: new WechatProvider(),
  wecom: new WecomProvider(),
  feishu: new FeishuProvider(),
  dingtalk: new DingtalkProvider(),
};

export function getProvider(name) {
  if (!registry[name]) {
    throw new Error(`[oauth] 未知 provider: ${name}`);
  }
  return registry[name];
}

// 读 settings 里 oauth_<name> 配置（JSON 字符串；secret 解密；未配置/损坏返回 null）
export async function loadConfig(name) {
  const raw = await getSetting(`oauth_${name}`);
  if (!raw) return null;
  try {
    const cfg = JSON.parse(raw);
    if (cfg.secret) cfg.secret = decryptKey(cfg.secret);
    return cfg;
  } catch {
    return null;
  }
}

// 生成授权 URL（未启用/未配置时抛错，前端据此隐藏入口）
export async function buildAuthUrl(name, state, redirectUri) {
  const provider = getProvider(name);
  const cfg = await loadConfig(name);
  if (!cfg || !cfg.enabled || !cfg.appId || !cfg.secret) {
    throw new Error(`[oauth:${name}] 未配置或未启用`);
  }
  return provider.buildAuthUrl(state, redirectUri, cfg);
}

// 回调统一交换：code → 归一化 profile（供路由层查/建号）
export async function oauthExchange(name, code, redirectUri) {
  const provider = getProvider(name);
  const cfg = await loadConfig(name);
  if (!cfg || !cfg.enabled || !cfg.appId || !cfg.secret) {
    throw new Error(`[oauth:${name}] 未配置或未启用`);
  }
  const { accessToken, extra } = await provider.exchangeToken(code, redirectUri, cfg);
  const profile = await provider.fetchProfile(accessToken, extra, cfg);
  return { profile, cfg };
}
