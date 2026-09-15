/**
 * AI 改动审查条（conversation.input.dock 槽）。
 *
 * 数据与官方 deliverables（产物行）同源同规则：ConversationSnapshot 的
 * tool-result 节点，认渲染意图（diff 卡 / generic edit）不认工具名。
 * 展示"最近一个已完成轮"的改动文件摘要：文件名 + 近似行数（+N −M）+
 * 新建标记；点击 chip 请求工作台打开该文件的 diff 审查视图
 * （emitOpenDiffReview 事件总线，见 change-review.ts）。
 *
 * 撤销（按块 / 按文件）不在本条上进行——destructive 操作统一收口在
 * EditorPane 的 diff 视图里，那里有 expectedVersion 乐观锁与过期校验。
 */
import { useMemo } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconClose } from './icons.tsx'
import {
  collectTurnChanges,
  latestCompletedTurn,
  emitOpenDiffReview,
  type FileChangeSummary,
} from './change-review.ts'
import css from './ChangeReviewBar.module.css'

/** 页面会话期内的收起记认：sessionId → 已收起的轮号；更新的轮次会重新出现。 */
const dismissedTurns = new Map<string, number>()

function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

function statsLabel(change: FileChangeSummary): string {
  if (!change.hasContent) return ''
  const parts: string[] = []
  if (change.adds > 0) parts.push(`+${change.adds}`)
  if (change.dels > 0) parts.push(`−${change.dels}`)
  return parts.join(' ')
}

export interface ChangeReviewBarProps
  extends PropsRuntime<'conversation.input.dock'>, PropsLocale<'workbench'> {
}

export function ChangeReviewBar({ sessionId, useSession, t }: ChangeReviewBarProps) {
  const nodes = useSession?.(state => state.nodes) as readonly unknown[] | undefined
  const turnEnds = useSession?.(state => state.turnEnds) as ReadonlyMap<number, number> | undefined
  const turn = useMemo(() => latestCompletedTurn(turnEnds), [turnEnds])
  const changes = useMemo(
    () => (turn === undefined ? [] : collectTurnChanges({ nodes, turnEnds }, turn)),
    [nodes, turnEnds, turn],
  )
  if (sessionId === undefined || turn === undefined || changes.length === 0) return null
  if ((dismissedTurns.get(sessionId) ?? 0) >= turn) return null

  const dismiss = (): void => {
    dismissedTurns.set(sessionId, turn)
  }

  return (
    <div className={css.root} data-change-review-bar>
      <span className={css.label}>{t('changeReview.label')}</span>
      <div className={css.row}>
        {changes.map(change => (
          <button
            key={change.path}
            type="button"
            className={css.file}
            title={change.path}
            aria-label={t('changeReview.open', { name: change.path })}
            onClick={() => { emitOpenDiffReview({ path: change.path, focus: true }) }}
          >
            <span className={css.fileName}>{basename(change.path)}</span>
            {change.isNew ? <span className={css.tagNew}>{t('changeReview.new')}</span> : null}
            {statsLabel(change) !== '' ? (
              <span className={css.stats} data-kind={change.adds > 0 && change.dels > 0 ? 'mix' : change.adds > 0 ? 'add' : 'del'}>
                {statsLabel(change)}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={css.dismiss}
        aria-label={t('changeReview.dismiss')}
        title={t('changeReview.dismiss')}
        onClick={dismiss}
      >
        <IconClose />
      </button>
    </div>
  )
}
