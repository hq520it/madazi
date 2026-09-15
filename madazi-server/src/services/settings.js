import { db } from '../db/init.js';

// 简单内存缓存，避免每次读取都打数据库。TTL 10 秒。
const cache = new Map();
let cacheTime = 0;
const CACHE_TTL = 10000;

// 已知配置项及默认值（数据库未初始化或读取失败时兜底）
const DEFAULTS = {
  preview_idle_timeout: '86400',
  preview_max_per_user: '3',
  preview_cpu_limit: '1',
  preview_memory_limit: '512',
  preview_global_max: '20',
  task_max_concurrent: '5', // 每项目 AI 任务并发数（dsh 链同 Pod 并发）
  merge_conflict_mode: 'manual', // merge 冲突策略：manual=保留分支手动合并；auto-llm=LLM 语义合并
};

async function refreshCache() {
  const { rows } = await db.query('SELECT key, value FROM settings');
  cache.clear();
  rows.forEach(r => cache.set(r.key, r.value));
  cacheTime = Date.now();
}

export async function getSetting(key, defaultValue = null) {
  if (Date.now() - cacheTime >= CACHE_TTL) {
    try {
      await refreshCache();
    } catch (err) {
      console.error('[settings] refresh failed:', err.message);
    }
  }
  if (cache.has(key)) return cache.get(key);
  if (defaultValue !== null) return defaultValue;
  return DEFAULTS[key] ?? null;
}

export async function getAllSettings() {
  if (Date.now() - cacheTime >= CACHE_TTL) {
    try {
      await refreshCache();
    } catch (err) {
      console.error('[settings] refresh failed:', err.message);
    }
  }
  return { ...DEFAULTS, ...Object.fromEntries(cache) };
}

export async function setSetting(key, value) {
  await db.query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
    [key, String(value)]
  );
  cache.delete(key);
  cacheTime = 0;
  return value;
}

export async function setSettings(obj) {
  for (const [key, value] of Object.entries(obj)) {
    await db.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
      [key, String(value)]
    );
  }
  // 强制刷新缓存，确保读取到最新值
  cache.clear();
  cacheTime = 0;
  return getAllSettings();
}

// 便捷方法：读取数字配置
export async function getSettingNumber(key, defaultValue = 0) {
  const v = await getSetting(key);
  const n = parseInt(v, 10);
  return isNaN(n) ? defaultValue : n;
}
