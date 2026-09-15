#!/usr/bin/env node
/**
 * LLM API Key 加密迁移（P0-3）
 * 用法（容器内，KEY_MASTER_SECRET 已注入）：
 *   sudo docker exec madazi-server node scripts/migrate-encrypt-keys.mjs
 * 幂等：已加密（enc:v1: 前缀）跳过；仅加密明文记录。
 */
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const { rows } = await client.query('SELECT id, name, api_key FROM llm_configs ORDER BY created_at');
  let encrypted = 0, skipped = 0;

  for (const r of rows) {
    const { encryptKey } = await import('../src/services/keycrypto.js');
    if (r.api_key && r.api_key.startsWith('enc:v1:')) {
      skipped++;
      continue;
    }
    const enc = encryptKey(r.api_key);
    await client.query('UPDATE llm_configs SET api_key = $1 WHERE id = $2', [enc, r.id]);
    encrypted++;
    console.log(`  [encrypt] ${r.name} (${r.id.slice(0, 8)}...)`);
  }

  console.log(`\n✅ 迁移完成：加密 ${encrypted} 条，跳过（已加密）${skipped} 条`);
  const { rows: after } = await client.query("SELECT count(*)::int AS total, count(*) FILTER (WHERE api_key LIKE 'enc:v1:%')::int AS enc FROM llm_configs");
  console.log(`   现在 ${after[0].total} 条中 ${after[0].enc} 条已加密`);
} finally {
  await client.end();
}
