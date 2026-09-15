// Redis 客户端单例（事件流：SSE 续传游标）
// 定位：短时事件流（TTL 1h 自动清），PG 才是长期真相源——Redis 不可用必须静默降级
import Redis from 'ioredis';

let redis = null;
let connecting = false;

export function getRedis() {
  if (redis) return redis;
  const url = process.env.REDIS_URL || 'redis://madazi-redis:6379';
  try {
    redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => (times > 10 ? null : Math.min(times * 200, 3000)),
      lazyConnect: false,
    });
    redis.on('error', (e) => {
      // 不打印堆栈，避免刷屏；连接失败自动进入降级
      console.log(`[redis] ${e.code || e.message}（事件流降级：SSE 续传不可用，其余功能不受影响）`);
    });
  } catch (e) {
    console.log(`[redis] init failed: ${e.message}，事件流降级`);
    redis = null;
  }
  return redis;
}

export function redisHealthy() {
  return !!redis && redis.status === 'ready';
}

// 写任务事件流（fire-and-forget，失败静默降级）
export async function writeTaskEvent(taskId, payload) {
  const r = getRedis();
  if (!r || r.status !== 'ready') return null;
  try {
    const id = await r.xadd(`stream:task:${taskId}`, '*', 'p', JSON.stringify(payload));
    // 事件流 TTL：任务结束后 1 小时自动清（短时数据，最终结果在 PG）
    if (id && Math.random() < 0.01) {
      r.pexpire(`stream:task:${taskId}`, 3600_000).catch(() => {});
    }
    return id;
  } catch (e) {
    console.warn(`[redis] writeTaskEvent 失败: ${e.message}`);
    return null;
  }
}

// 读取任务事件流（重放/续传），fromId 为 '0' 全量 / 上次事件 ID 续传
export async function readTaskEvents(taskId, fromId = '0', count = 10000) {
  const r = getRedis();
  if (!r || r.status !== 'ready') return [];
  try {
    const res = await r.xrange(`stream:task:${taskId}`, fromId === '0' ? '-' : `(${fromId}`, '+', 'COUNT', count);
    return res.map(([id, fields]) => {
      try {
        const idx = fields.indexOf('p');
        return { id, payload: idx >= 0 ? JSON.parse(fields[idx + 1]) : {} };
      } catch {
        return { id, payload: {} };
      }
    });
  } catch (e) {
    return [];
  }
}

// 实时读任务事件流：XREAD BLOCK 阻塞等待新事件（SSE 无状态转发用）
// cursor='$' 从最新开始；返回 { entries, cursor }，超时无事件返回 { entries: [], cursor }
export async function readTaskEventsLive(taskId, cursor = '$', blockMs = 5000) {
  const r = getRedis();
  if (!r || r.status !== 'ready') return { entries: [], cursor };
  try {
    const res = await r.xreadBuffer('COUNT', 100, 'BLOCK', blockMs, 'STREAMS', `stream:task:${taskId}`, cursor);
    if (!res || !res.length) return { entries: [], cursor };
    const items = res[0][1] || [];
    if (!items.length) return { entries: [], cursor };
    const entries = items.map(([id, fields]) => {
      const buf = Buffer.isBuffer(fields[1]) ? fields[1] : fields[1];
      try {
        return { id: id.toString(), payload: JSON.parse(buf.toString()) };
      } catch {
        return { id: id.toString(), payload: {} };
      }
    });
    return { entries, cursor: entries[entries.length - 1].id };
  } catch (e) {
    return { entries: [], cursor };
  }
}

export default getRedis;
