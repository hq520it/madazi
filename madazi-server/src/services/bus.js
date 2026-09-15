// P1 事件总线：server 多副本的跨实例广播通道（Redis pub/sub）
// 设计要点：
// - 单频道 `madazi:bus` 承载全部消息（presence/chat/kick/reset/buildlog），JSON 帧
// - 每条消息带 from=nodeId：本地 fanout 立即执行（同步语义与单副本一致），
//   Redis 回声按 from 去重 → 恰好一次本地执行
// - 优雅降级：REDIS_URL 未配置 / 连接失败 / 断线 → 本地模式（publish 仅本地
//   fanout，行为与今天单副本完全一致）；ioredis 自动重连，恢复即回到 Redis 模式
// - 心跳由上层（project-ws）驱动 presence 快照上报，本模块只管传输
import { randomUUID } from 'crypto';

export const nodeId = randomUUID().slice(0, 8);
const CHANNEL = 'madazi:bus';

const handlers = new Set(); // (msg) => void
let pub = null;
let sub = null;

function fanout(msg) {
  for (const h of handlers) {
    try { h(msg); } catch (err) { console.error('[bus] handler error:', err.message); }
  }
}

// ★ 启动即调用（不 await，不阻塞 server 启动；失败静默降级）
export function initBus() {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.log('[bus] REDIS_URL 未配置 → 本地模式（单副本行为）');
    return;
  }
  import('ioredis')
    .then(async ({ default: Redis }) => {
      const opts = {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => Math.min(times * 500, 5000),
        connectTimeout: 5000,
      };
      pub = new Redis(url, opts);
      sub = new Redis(url, opts);
      sub.on('message', (_ch, raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        if (msg.from === nodeId) return; // 本地 fanout 已处理
        fanout(msg);
      });
      sub.on('error', (e) => console.warn('[bus] sub error:', e.message));
      pub.on('error', (e) => console.warn('[bus] pub error:', e.message));
      await Promise.all([pub.connect(), sub.connect()]);
      await sub.subscribe(CHANNEL);
      console.log(`[bus] Redis 已连接（node=${nodeId}）→ 跨副本广播启用`);
    })
    .catch((e) => {
      console.warn('[bus] Redis 连接失败 → 本地降级模式:', e.message);
    });
}

// 注册消息处理（本地+远端统一入口）。返回取消函数。
export function onBus(handler) {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

// 发布：本地立即 fanout；Redis ready 时同步广播到其他副本
export function publish(msg) {
  const m = { ...msg, from: nodeId };
  fanout(m);
  if (pub && pub.status === 'ready') {
    pub.publish(CHANNEL, JSON.stringify(m)).catch(() => { /* 断线即本地模式 */ });
  }
}
