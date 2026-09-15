export const IDE_STYLE_ID = 'dsh-workbench-plugin/ide-split'

/**
 * Split the conversation COLUMN (parent of the native scrollport).
 * Never change display/overflow on [data-conversation-scroll]: that node is
 * the chat scrollport, and the composer must stay position:sticky inside it.
 */
export const IDE_HOST_CSS = `
[data-git-ide]{
  display:grid !important;
  grid-template-columns: var(--git-col-chat, minmax(300px, 38%)) minmax(0, 1fr) var(--git-col-side, 280px);
  grid-template-rows: auto minmax(0, 1fr) auto;
  align-items: stretch;
  justify-content: stretch;
  overflow: hidden !important;
  min-width: 0 !important;
  min-height: 0 !important;
  height: 100%;
}
/* 收起编辑器：左侧对话吃掉中间空间，文件/Git 侧栏始终钉在最右侧 */
[data-git-ide][data-git-editor=off]{
  grid-template-columns: minmax(0, 1fr) 36px var(--git-col-side, 280px);
}
[data-git-ide][data-git-side=off]{
  grid-template-columns: var(--git-col-chat, minmax(300px, 38%)) minmax(0, 1fr) 36px;
}
[data-git-ide][data-git-editor=off][data-git-side=off]{
  grid-template-columns: minmax(0, 1fr) 36px 36px;
}
[data-git-ide][data-git-chat=off]{
  grid-template-columns: 36px minmax(0, 1fr) var(--git-col-side, 280px);
}
[data-git-ide][data-git-chat=off][data-git-editor=off]{
  grid-template-columns: 36px 36px var(--git-col-side, 280px);
  justify-content: end;
}
[data-git-ide][data-git-chat=off][data-git-side=off]{
  grid-template-columns: 36px minmax(0, 1fr) 36px;
}
[data-git-ide][data-git-chat=off][data-git-editor=off][data-git-side=off]{
  grid-template-columns: 36px 36px 36px;
  justify-content: end;
}
[data-git-ide] > :not([data-conversation-scroll]):not([data-git-ide-panel]){
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
}
/* 官方 transcript 宽度手柄（[data-width-handle]，绝对定位，逃出 grid 槽位
   悬浮整行）与工作台自带 ColSash 冲突：split 激活即隐藏，关闭工作台恢复
   官方行为。选择器用稳定 data 属性（官方 hash 类名随构建漂移，不可依赖）；
   官方自身也有先例：composer overlay 出现时同样 display:none。 */
[data-git-ide] > [data-width-handle]{
  display: none !important;
}
[data-git-ide][data-git-chat=off] > :not([data-conversation-scroll]):not([data-git-ide-panel]){
  display: none !important;
}
[data-git-ide] > [data-conversation-scroll]{
  grid-column: 1;
  grid-row: 2 / -1;
  min-width: 0 !important;
  min-height: 0 !important;
  max-height: 100%;
  border-right: 1px solid var(--dsw-alias-border-l2);
}
/* Blank new-session hero: keep the composer centered in the chat column. */
[data-git-ide][data-phase=hero] > [data-conversation-scroll]{
  justify-content: center;
}
[data-git-ide][data-git-chat=off] > [data-conversation-scroll]{
  display: none !important;
}
[data-git-ide-panel=editor],
[data-git-ide-panel=side],
[data-git-ide-panel=rail-side],
[data-git-ide-panel=rail-editor]{
  position: relative;
  min-width: 0;
  max-width: 100%;
  min-height: 0;
  overflow: hidden;
  align-self: stretch;
}
[data-git-ide-panel=editor],
[data-git-ide-panel=rail-editor]{
  grid-column: 2;
  grid-row: 1 / 3;
}
[data-git-ide-panel=side],
[data-git-ide-panel=rail-side]{
  grid-column: 3;
  grid-row: 1 / 3;
}
/* Editor-only bottom chrome: the side column keeps full height beside it. */
[data-git-ide][data-git-bottom-span=editor] [data-git-ide-panel=side],
[data-git-ide][data-git-bottom-span=editor] [data-git-ide-panel=rail-side]{
  grid-row: 1 / -1;
}
[data-git-ide-panel=rail-chat]{ grid-column: 1; grid-row: 2 / -1; }
/* Full-height column sashes sit on the grid so they still work over the
   bottom terminal and when the editor/side is a 36px rail. */
[data-git-ide-panel=sash-chat],
[data-git-ide-panel=sash-side]{
  position: relative;
  z-index: 8;
  width: 5px;
  min-width: 5px;
  margin-left: -2px;
  align-self: stretch;
  overflow: visible;
}
[data-git-ide-panel=sash-chat]{
  grid-column: 2;
  grid-row: 1 / -1;
  justify-self: start;
}
[data-git-ide-panel=sash-side]{
  grid-column: 3;
  grid-row: 1 / -1;
  justify-self: start;
}
/* Terminal + status bar share one bottom strip so a leftover grid row cannot sit empty between them. */
[data-git-ide-panel=bottom]{
  grid-column: 2 / -1;
  grid-row: 3;
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
[data-git-ide][data-git-bottom-span=editor] [data-git-ide-panel=bottom]{
  grid-column: 2;
}
[data-git-ide][data-git-bottom-span=right] [data-git-ide-panel=bottom]{
  grid-column: 2 / -1;
}
[data-git-ide][data-git-bottom-span=full] [data-git-ide-panel=bottom]{
  grid-column: 1 / -1;
}
[data-git-ide-panel=status]{
  flex: none;
  z-index: 5;
  min-width: 0;
  overflow: visible;
}
[data-git-ide-panel=terminal]{
  position: relative;
  flex: none;
  box-sizing: border-box;
  height: var(--git-term-h, 220px);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
[data-git-ide-panel=bottom-tools]{
  flex: none;
  height: var(--git-term-h, 220px);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
[data-git-ide-panel=bottom-tools] [data-git-ide-panel=terminal],
[data-git-ide-panel=bottom-tools] [data-git-ide-panel=devtools]{
  height: auto;
  flex: 1;
  min-height: 0;
}
/* Full-width bottom chrome: chat stops above the panel so commands get the whole row. */
[data-git-ide][data-git-bottom-span=full] > [data-conversation-scroll]{
  grid-row: 2;
}
[data-git-ide][data-git-bottom-span=full] [data-git-ide-panel=rail-chat]{
  grid-row: 2;
}
/* File-tree drag over the composer: outline the input seat so dropping is obvious. */
[data-composer-seat][data-dsh-drop-target]{
  outline: 2px dashed var(--dsw-alias-accent-primary, #4c8dff);
  outline-offset: -2px;
  border-radius: 8px;
}
/* Official chip centers short names. Long names are marked in JS and
   aligned to the end so the suffix stays visible. */
[data-decoration="chip"][data-dsh-long]>span{
  justify-content:flex-end!important;
  text-align:right!important;
}
/* 移动端/窄屏（<1280）：workbench 是桌面 IDE 布局，未做移动专属适配——
   保持 1280 桌面宽度，横向滚动查看/操作完整界面。
   ★ 方案演进：
     - 容器化（#root 锁 body）会锁死滚动 → 不可用，已弃。
     - 回归 body 级横向滚动（可滑）：html/body overflow-x auto + min-width 1280。
     - 「显示不全」根因是官方 app 根（#root 直接子）overflow 裁剪 1280 溢出 →
       #root > * 设 overflow-x:auto + min-width:1280 放行，内容完整参与滚动。
     - 丝滑：overscroll-behavior-x:contain 隔离横向边界（不触发浏览器返回/弹跳），
       -webkit-overflow-scrolling:touch 提供 iOS 惯性。
   仅窄屏生效，桌面不受影响。 */
@media (max-width: 1279px){
  html, body{
    overflow-x: auto !important;
    min-width: 1280px !important;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain !important;
  }
  /* ★ data-git-ide 的所有祖先（#root 下包含它的元素）：
     设 1280 宽 + 横向 auto，不再 overflow:hidden 裁掉右侧。
     根因：data-git-ide 被 min-width 撑到 1280，但官方中间列(centerCol)只有
     ~1000 且 overflow:hidden → data-git-ide 右侧 280px（文件管理侧栏）被切断。
     :has() 动态选中所有祖先层，不依赖官方 hash 类名，官方升级也不失效 */
  #root *:has([data-git-ide]){
    min-width: 1280px !important;
    overflow-x: auto !important;
  }
  [data-git-ide]{ min-width: 1280px !important; }
}
`

export function ensureIdeStyles(): void {
  let tag = document.querySelector(`style[data-plugin-css="${IDE_STYLE_ID}"]`)
  if (!(tag instanceof HTMLStyleElement)) {
    tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-workbench-plugin'
    tag.dataset.pluginCss = IDE_STYLE_ID
    document.head.appendChild(tag)
  }
  if (tag.textContent !== IDE_HOST_CSS) tag.textContent = IDE_HOST_CSS
}
