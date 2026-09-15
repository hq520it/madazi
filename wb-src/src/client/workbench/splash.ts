/**
 * 启动隐藏（madazi fork 定制，已彻底移除）：
 * 曾按 workbench 就绪隐藏会话列 + 配合 login 插件 splash 盖层。现已全部去掉
 * madazi loading 盖层（boot shield / splash），登录/加载期间直接显示 DSH 官方
 * loading plugins；后续如需优化启动体验，直接改本仓库（DSH fork 源码）实现。
 *
 * 保留空实现（injectSplashStyle / onGitIdeMounted）以兼容 Workbench.tsx 的既有调用。
 */
const SPLASH_STYLE_ID = 'wb-splash-css'

export function injectSplashStyle(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(SPLASH_STYLE_ID) !== null) return
  const st = document.createElement('style')
  st.id = SPLASH_STYLE_ID
  // no-op：不注入任何隐藏规则，DSH 默认界面直接可见
  st.textContent = ''
  document.head.appendChild(st)
}

/**
 * gitIde 打标状态回调。mounted 不再影响任何可见性（无盖层逻辑）。
 */
export function onGitIdeMounted(_mounted: boolean): void {
  // no-op
}
