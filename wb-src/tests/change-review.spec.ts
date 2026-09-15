import { describe, expect, it } from 'vitest'
import {
  collectChangedPaths,
  collectTurnChanges,
  hunkNewSide,
  hunkOldSide,
  latestCompletedTurn,
  lineDelta,
  mutationPathsOf,
  parseDiffHunks,
  rejectHunks,
  turnSeqRange,
  type ToolResultNodeLike,
} from '../src/client/workbench/change-review.ts'

function toolResult(seq: number, opts: {
  isError?: boolean
  callView?: ToolResultNodeLike['callView']
  resultView?: ToolResultNodeLike['resultView']
} = {}): unknown {
  return {
    kind: 'tool-result',
    seq,
    isError: opts.isError ?? false,
    callView: opts.callView ?? null,
    resultView: opts.resultView ?? null,
  }
}

describe('mutationPathsOf', () => {
  it('diff 卡：locations 与 diffs 的路径去重合并', () => {
    expect(mutationPathsOf({
      card: 'diff',
      locations: [{ path: 'a.ts' }, { path: '' }],
      diffs: [{ path: 'a.ts', oldText: null, newText: 'x' }, { path: 'b.ts', oldText: 'y', newText: 'z' }],
    })).toEqual(['a.ts', 'b.ts'])
  })

  it('generic edit 卡：取 locations', () => {
    expect(mutationPathsOf({ card: 'generic', kind: 'edit', locations: [{ path: 'new.md' }] }))
      .toEqual(['new.md'])
  })

  it('generic 非 edit / 未知卡 / null：无产出', () => {
    expect(mutationPathsOf({ card: 'generic', kind: 'read', locations: [{ path: 'a.ts' }] })).toEqual([])
    expect(mutationPathsOf({ card: 'terminal' })).toEqual([])
    expect(mutationPathsOf(null)).toEqual([])
  })
})

describe('turnSeqRange / latestCompletedTurn', () => {
  const turnEnds = new Map([[1, 10], [2, 20], [4, 40]])

  it('区间为 (上一轮 endSeq, 本轮 endSeq]', () => {
    expect(turnSeqRange(turnEnds, 2)).toEqual({ start: 10, end: 20 })
    expect(turnSeqRange(turnEnds, 4)).toEqual({ start: 20, end: 40 })
  })

  it('首轮从 0 起；未知轮 end 为无穷', () => {
    expect(turnSeqRange(turnEnds, 1)).toEqual({ start: 0, end: 10 })
    expect(turnSeqRange(turnEnds, 3)).toEqual({ start: 20, end: Number.POSITIVE_INFINITY })
  })

  it('最近一个已完成轮', () => {
    expect(latestCompletedTurn(turnEnds)).toBe(4)
    expect(latestCompletedTurn(undefined)).toBeUndefined()
    expect(latestCompletedTurn(new Map())).toBeUndefined()
  })
})

describe('collectTurnChanges / collectChangedPaths', () => {
  it('按轮过滤、失败剔除、同文件聚合统计', () => {
    const snapshot = {
      nodes: [
        // 第 1 轮（seq ≤ 10）：不应计入第 2 轮
        toolResult(5, { callView: { card: 'diff', diffs: [{ path: 'turn1.ts', oldText: null, newText: 'x' }] } }),
        // 第 2 轮：a.ts 先加一行再删两行
        toolResult(11, { callView: { card: 'diff', diffs: [{ path: 'a.ts', oldText: 'l1\nl2', newText: 'l1\nl2\nl3' }] } }),
        toolResult(12, { callView: { card: 'diff', diffs: [{ path: 'a.ts', oldText: 'l1\nl2\nl3', newText: 'l1' }] } }),
        // 第 2 轮失败调用：剔除
        toolResult(13, { isError: true, callView: { card: 'diff', diffs: [{ path: 'bad.ts', oldText: null, newText: 'x' }] } }),
        // 第 2 轮 generic edit：仅路径无内容
        toolResult(15, { callView: { card: 'generic', kind: 'edit', locations: [{ path: 'b.md' }] } }),
        // 第 3 轮（seq > 20）：不属第 2 轮，但进全窗口集合
        toolResult(25, { callView: { card: 'diff', diffs: [{ path: 'next.ts', oldText: null, newText: 'n' }] } }),
      ],
      turnEnds: new Map([[1, 10], [2, 20]]),
    }
    const turn2 = collectTurnChanges(snapshot, 2)
    expect(turn2.map(c => c.path)).toEqual(['a.ts', 'b.md'])
    // a.ts: +1 -0 与 +0 -2 聚合
    expect(turn2[0]).toMatchObject({ adds: 1, dels: 2, isNew: false, hasContent: true })
    // b.md：generic edit 无内容，仅路径
    expect(turn2[1]).toMatchObject({ adds: 0, dels: 0, isNew: false, hasContent: false })

    // 全窗口路径集合（含失败剔除）
    expect([...collectChangedPaths(snapshot)].sort()).toEqual(['a.ts', 'b.md', 'next.ts', 'turn1.ts'])
  })

  it('oldText 为 null 标记新建', () => {
    const snapshot = {
      nodes: [toolResult(1, { callView: { card: 'diff', diffs: [{ path: 'new.ts', oldText: null, newText: 'a\nb' }] } })],
      turnEnds: new Map([[1, 2]]),
    }
    expect(collectTurnChanges(snapshot, 1)[0]).toMatchObject({ isNew: true, adds: 2, dels: 0 })
  })
})

describe('lineDelta', () => {
  it('新建：+新行数', () => {
    expect(lineDelta(null, 'a\nb\nc')).toEqual({ adds: 3, dels: 0 })
  })

  it('LCS 行差异', () => {
    expect(lineDelta('a\nb', 'a\nc')).toEqual({ adds: 1, dels: 1 })
    expect(lineDelta('a\nb\nc', 'a\nb\nc')).toEqual({ adds: 0, dels: 0 })
    expect(lineDelta('', 'a')).toEqual({ adds: 1, dels: 0 })
  })
})

describe('parseDiffHunks', () => {
  const DIFF = [
    'diff --git a/a.ts b/a.ts',
    'index 111..222 100644',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,3 +1,4 @@',
    ' ctx',
    '-old',
    '+new',
    '+new2',
    '@@ -10 +10 @@',
    ' same',
    '\\ No newline at end of file',
  ].join('\n')

  it('切分为带序号的 hunk，跳过文件头与 no-newline 行', () => {
    const hunks = parseDiffHunks(DIFF)
    expect(hunks).toHaveLength(2)
    expect(hunks[0]).toMatchObject({ index: 0, oldStart: 1, oldCount: 3, newStart: 1, newCount: 4 })
    expect(hunks[0]!.rows.map(r => r.kind)).toEqual(['ctx', 'del', 'add', 'add'])
    expect(hunks[1]).toMatchObject({ index: 1, oldStart: 10, oldCount: 1, newStart: 10, newCount: 1 })
    expect(hunks[1]!.rows).toHaveLength(1)
  })

  it('空文本返回空数组', () => {
    expect(parseDiffHunks('')).toEqual([])
    expect(parseDiffHunks('   ')).toEqual([])
  })

  it('新旧两侧内容提取', () => {
    const hunk = parseDiffHunks(DIFF)[0]!
    expect(hunkOldSide(hunk)).toEqual(['ctx', 'old'])
    expect(hunkNewSide(hunk)).toEqual(['ctx', 'new', 'new2'])
  })
})

describe('rejectHunks', () => {
  // 原文 5 行：a b c d e；两处改动：b→B（hunk0），e 后加 E（hunk1）
  const DIFF = [
    '@@ -1,3 +1,3 @@',
    ' a',
    '-b',
    '+B',
    ' c',
    '@@ -4,2 +4,3 @@',
    ' d',
    ' e',
    '+E',
  ].join('\n')
  const OLD = 'a\nb\nc\nd\ne'
  const NEW = 'a\nB\nc\nd\ne\nE'

  it('撤销单个 hunk：只回滚该块', () => {
    expect(rejectHunks(NEW, parseDiffHunks(DIFF), new Set([0]))).toBe('a\nb\nc\nd\ne\nE')
  })

  it('撤销全部 hunk：回到旧文', () => {
    expect(rejectHunks(NEW, parseDiffHunks(DIFF), new Set([0, 1]))).toBe(OLD)
  })

  it('倒序处理保证多块下标正确', () => {
    expect(rejectHunks(NEW, parseDiffHunks(DIFF), new Set([1]))).toBe('a\nB\nc\nd\ne')
  })

  it('新文件全量新增 hunk 全撤销 → 空内容', () => {
    const diff = ['@@ -0,0 +1,2 @@', '+x', '+y'].join('\n')
    expect(rejectHunks('x\ny', parseDiffHunks(diff), new Set([0]))).toBe('')
  })

  it('内容对不上（过期）返回 null', () => {
    expect(rejectHunks('a\nZ\nc\nd\ne\nE', parseDiffHunks(DIFF), new Set([0]))).toBeNull()
  })

  it('文件比 diff 短（越界）返回 null', () => {
    expect(rejectHunks('a', parseDiffHunks(DIFF), new Set([1]))).toBeNull()
  })

  it('空选择 / 无匹配 hunk 原样返回', () => {
    expect(rejectHunks(NEW, parseDiffHunks(DIFF), new Set())).toBe(NEW)
  })
})
