-- madazi 计费修正迁移：model_costs 官方币种 + 官方价（2026-08-11）
-- 1) 加 currency 列
ALTER TABLE model_costs ADD COLUMN IF NOT EXISTS currency VARCHAR(8) NOT NULL DEFAULT 'USD';

-- 2) deepseek 更新为官方 CNY 价（官方定价页：百万 tokens，缓存未命中档）
UPDATE model_costs SET currency='CNY', input_price_per_m=1.00, output_price_per_m=2.00, updated_at=NOW()
  WHERE model='deepseek-v4-flash';
UPDATE model_costs SET currency='CNY', input_price_per_m=3.00, output_price_per_m=6.00, updated_at=NOW()
  WHERE model='deepseek-v4-pro';

-- 3) 智谱/通义官方价 upsert（官方定价页：百万 tokens，基础档）
INSERT INTO model_costs (model, currency, input_price_per_m, output_price_per_m, updated_at) VALUES
  ('glm-5.2',   'CNY', 8.00, 28.00, NOW()),
  ('glm-5.1',   'CNY', 6.00, 24.00, NOW()),
  ('qwen3-coder','CNY', 4.00, 16.00, NOW()),
  ('qwen3.7-plus','CNY', 2.00,  8.00, NOW())
ON CONFLICT (model) DO UPDATE SET currency=EXCLUDED.currency,
  input_price_per_m=EXCLUDED.input_price_per_m, output_price_per_m=EXCLUDED.output_price_per_m, updated_at=NOW();

-- 4) 删除未核实价行（kimi/doubao/gpt/claude 价格页抓取失败 → 不猜价；由管理端核对后配置）
DELETE FROM model_costs WHERE model NOT IN
  ('deepseek-v4-flash','deepseek-v4-pro','glm-5.2','glm-5.1','qwen3-coder','qwen3.7-plus');

-- 5) 汇率设置（CNY→USD 折算，管理端可改）
INSERT INTO settings (key, value) VALUES ('usd_cny_rate', '7.2')
  ON CONFLICT (key) DO NOTHING;
