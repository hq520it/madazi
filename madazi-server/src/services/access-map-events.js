// 权限映射变更信号总线（2026-09-05）
// 会话归属 / 项目成员 / 用户角色变更时 bumpAccessMap()，dsh-web 的 sandbox-clamp
// 通过 SSE（/api/dsh/access-map/events）订阅 changed 信号后全量重拉 session-access-map。
// 替代轮询：撤销/授权秒级生效；全部变更点集中可审计（grep bumpAccessMap 全量核对）。
import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();
const CHANGED = 'access-map-changed';

export function bumpAccessMap() {
  emitter.emit(CHANGED);
}

export function onAccessMapChanged(listener) {
  emitter.on(CHANGED, listener);
  return () => emitter.off(CHANGED, listener);
}
