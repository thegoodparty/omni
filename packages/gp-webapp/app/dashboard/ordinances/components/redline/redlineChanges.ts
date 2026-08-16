import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Mark, MarkType } from '@tiptap/pm/model'

// Per-change accept/reject for the redline editor. A "change" is a maximal run
// of contiguous redline-marked text within one textblock — an inserted run, a
// struck run, or an adjacent {-struck-}{+inserted+} pair (one logical edit).
// Kept pure and separate from the React editor so the range-finding and the
// resolving transaction are unit-testable without a laid-out view.

export type ChangeAction = 'accept' | 'reject'

const isRedline = (
  marks: readonly Mark[],
  ins: MarkType,
  del: MarkType,
): boolean => ins.isInSet(marks) != null || del.isInSet(marks) != null

// The [from, to] of the redline run containing `pos`, or null when `pos` is not
// inside a change. Runs stop at unchanged text and block boundaries.
export const changeRangeAt = (
  state: EditorState,
  pos: number,
): [number, number] | null => {
  const ins = state.schema.marks.insertion
  const del = state.schema.marks.deletion
  if (!ins || !del) return null
  const $pos = state.doc.resolve(
    Math.max(0, Math.min(pos, state.doc.content.size)),
  )
  const parent = $pos.parent
  if (!parent.isTextblock) return null
  const parentStart = $pos.start()
  let runStart = -1
  let runEnd = -1
  let found: [number, number] | null = null
  parent.forEach((child, offset) => {
    const start = parentStart + offset
    const end = start + child.nodeSize
    if (child.isText && isRedline(child.marks, ins, del)) {
      if (runStart === -1) runStart = start
      runEnd = end
    } else if (runStart !== -1) {
      if (pos >= runStart && pos <= runEnd) found = [runStart, runEnd]
      runStart = -1
      runEnd = -1
    }
  })
  if (runStart !== -1 && pos >= runStart && pos <= runEnd) {
    found = [runStart, runEnd]
  }
  return found
}

// Resolve the change spanning [from, to]. Accept keeps the insertion (dropping
// its mark to make it plain) and deletes the struck text; reject is the mirror
// (keep the struck text as plain, delete the insertion). Returns null when the
// range holds no redline, so a stray call is a no-op. Pure and unit-testable.
export const resolveChangeTransaction = (
  state: EditorState,
  from: number,
  to: number,
  action: ChangeAction,
): Transaction | null => {
  const ins = state.schema.marks.insertion
  const del = state.schema.marks.deletion
  if (!ins || !del) return null
  const dropMark = action === 'accept' ? del : ins
  const keepMark = action === 'accept' ? ins : del
  const drops: [number, number][] = []
  const keeps: [number, number][] = []
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return
    const start = Math.max(pos, from)
    const end = Math.min(pos + node.nodeSize, to)
    if (start >= end) return
    if (dropMark.isInSet(node.marks)) drops.push([start, end])
    else if (keepMark.isInSet(node.marks)) keeps.push([start, end])
  })
  if (drops.length === 0 && keeps.length === 0) return null
  const tr = state.tr
  // Unwrap the kept ranges first (positions are stable under removeMark), then
  // delete the dropped ranges right-to-left so earlier ranges keep positions.
  for (const [start, end] of keeps) tr.removeMark(start, end, keepMark)
  for (const [start, end] of [...drops].sort((a, b) => b[0] - a[0])) {
    tr.delete(start, end)
  }
  return tr
}
