// 平台路径唯一来源（2026-09-12 去硬编码化）
// 所有涉及"项目数据目录/DSH 数据目录"的代码一律从这里 import，禁止再写死
// /app/generated 或开发机绝对路径。
//
// 部署形态：
//   - k8s ：server pod workingDir=/app → PROJECTS_ROOT=/app/generated；
//          dsh-web 设 DSH_HOME=/app/generated/.dsh（server-deployment 显式注入二者）
//   - 单机版：start.sh 显式注入 PROJECTS_ROOT=.../madazi-server/generated、DSH_HOME=~/.madazi/dsh-home
//   - 裸跑（无任何 env）：PROJECTS_ROOT=process.cwd()/generated，DSH_HOME=<root>/.dsh
import path from 'path';

export const PROJECTS_ROOT = path.resolve(
  process.env.PROJECTS_ROOT || path.join(process.cwd(), 'generated')
);

export const DSH_HOME = path.resolve(
  process.env.DSH_HOME || path.join(PROJECTS_ROOT, '.dsh')
);

// dsh storages（session_projcache / workspace.json 等共享缓存）落点
export const DSH_STORAGES = path.join(DSH_HOME, 'storages');