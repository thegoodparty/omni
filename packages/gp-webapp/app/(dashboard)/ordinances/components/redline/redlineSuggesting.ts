import { Extension } from '@tiptap/core'
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state'
import { type EditorView } from '@tiptap/pm/view'

// Suggesting-mode editing for ordinance amendments: typed text is marked as an
// insertion, and deleting baseline (unmarked) text strikes it with a deletion
// mark instead of removing it. Deleting the user's own insertion removes it;
// text already marked deleted is left to the editor's default handling. This is
// a first pass — typing over a selection replaces rather than strikes, and it
// doesn't yet handle paste — but it covers the common type-and-delete flow.

export interface DeletionPlan {
  // Insertion-marked ranges to actually delete (the user's own new text).
  removals: [number, number][]
  // Baseline ranges to mark as deleted (strike, don't remove).
  strikes: [number, number][]
}

// Classify a delete range into removals vs strikes. Pure so it is unit-testable
// without a live editor view.
export const planDeletion = (
  state: EditorState,
  from: number,
  to: number,
): DeletionPlan => {
  const ins = state.schema.marks.insertion
  const del = state.schema.marks.deletion
  const removals: [number, number][] = []
  const strikes: [number, number][] = []
  if (!ins || !del) return { removals, strikes }
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return
    const start = Math.max(pos, from)
    const end = Math.min(pos + node.nodeSize, to)
    if (start >= end) return
    if (ins.isInSet(node.marks)) removals.push([start, end])
    else if (!del.isInSet(node.marks)) strikes.push([start, end])
  })
  return { removals, strikes }
}

// Builds the transaction for a delete range: strikes baseline text with the
// deletion mark and removes the user's own insertions. Returns null when
// there's nothing to do (a block boundary or an already-struck run), so the
// editor handles it. Pure, so it's unit-testable without a live editor view.
export const deletionTransaction = (
  state: EditorState,
  from: number,
  to: number,
): Transaction | null => {
  const del = state.schema.marks.deletion
  if (!del) return null
  const { removals, strikes } = planDeletion(state, from, to)
  if (removals.length === 0 && strikes.length === 0) return null
  const tr = state.tr
  // Marks first (positions are stable under addMark), then delete right-to-left
  // so earlier ranges keep their positions.
  for (const [start, end] of strikes) tr.addMark(start, end, del.create())
  for (const [start, end] of [...removals].sort((a, b) => b[0] - a[0])) {
    tr.delete(start, end)
  }
  // `near` (not `create`) so a select-all delete, whose `from` is 0 and not a
  // valid text position, resolves to the nearest textblock instead of throwing.
  tr.setSelection(
    TextSelection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size))),
  )
  return tr
}

const applyDeletion = (view: EditorView, from: number, to: number): boolean => {
  const tr = deletionTransaction(view.state, from, to)
  if (!tr) return false
  view.dispatch(tr)
  return true
}

export const RedlineSuggesting = Extension.create({
  name: 'redlineSuggesting',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('redlineSuggesting'),
        props: {
          handleTextInput(view, from, to, text) {
            // The plugin is registered whenever suggesting is on (so it
            // survives the editable toggle), but only acts when editable.
            if (!view.editable) return false
            const ins = view.state.schema.marks.insertion
            if (!ins) return false
            const node = view.state.schema.text(text, [ins.create()])
            view.dispatch(view.state.tr.replaceWith(from, to, node))
            return true
          },
          handleKeyDown(view, event) {
            if (!view.editable) return false
            const { selection, doc } = view.state
            if (event.key === 'Backspace') {
              const from = selection.empty ? selection.from - 1 : selection.from
              const to = selection.empty ? selection.from : selection.to
              return from < 0 ? false : applyDeletion(view, from, to)
            }
            if (event.key === 'Delete') {
              const from = selection.from
              const to = selection.empty ? selection.from + 1 : selection.to
              return to > doc.content.size
                ? false
                : applyDeletion(view, from, to)
            }
            return false
          },
        },
      }),
    ]
  },
})
