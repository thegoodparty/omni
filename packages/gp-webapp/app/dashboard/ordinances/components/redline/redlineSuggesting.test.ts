import { describe, expect, it } from 'vitest'
import { Schema, type Mark } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { deletionTransaction, planDeletion } from './redlineSuggesting'

// Minimal schema mirroring the redline marks, so planDeletion is testable
// without booting a full TipTap editor.
const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', toDOM: () => ['p', 0] },
    text: {},
  },
  marks: {
    insertion: { toDOM: () => ['ins', 0] },
    deletion: { toDOM: () => ['del', 0] },
  },
})
const insMark = schema.marks.insertion
const delMark = schema.marks.deletion
if (!insMark || !delMark) throw new Error('schema is missing the redline marks')

// Build a one-paragraph doc from segments. In the resulting doc the first text
// character sits at position 1 (position 0 is before the paragraph).
const stateFrom = (
  segs: { text: string; mark?: 'insertion' | 'deletion' }[],
): EditorState => {
  const nodes = segs.map((s) => {
    const marks: Mark[] =
      s.mark === 'insertion'
        ? [insMark.create()]
        : s.mark === 'deletion'
          ? [delMark.create()]
          : []
    return schema.text(s.text, marks)
  })
  const doc = schema.node('doc', null, [schema.node('paragraph', null, nodes)])
  return EditorState.create({ doc, schema })
}

describe('planDeletion', () => {
  it('strikes baseline text rather than removing it', () => {
    const state = stateFrom([{ text: 'abc' }])
    expect(planDeletion(state, 1, 4)).toEqual({
      strikes: [[1, 4]],
      removals: [],
    })
  })

  it('removes the user’s own insertion text', () => {
    const state = stateFrom([{ text: 'x' }, { text: 'yz', mark: 'insertion' }])
    expect(planDeletion(state, 2, 4)).toEqual({
      strikes: [],
      removals: [[2, 4]],
    })
  })

  it('leaves already-struck text alone (neither strike nor remove)', () => {
    const state = stateFrom([{ text: 'gone', mark: 'deletion' }])
    expect(planDeletion(state, 1, 5)).toEqual({ strikes: [], removals: [] })
  })

  it('splits a mixed range into a strike and a removal', () => {
    const state = stateFrom([{ text: 'a' }, { text: 'b', mark: 'insertion' }])
    expect(planDeletion(state, 1, 3)).toEqual({
      strikes: [[1, 2]],
      removals: [[2, 3]],
    })
  })
})

describe('deletionTransaction', () => {
  it('strikes baseline text with the deletion mark, keeping the text', () => {
    const state = stateFrom([{ text: 'abc' }])
    const tr = deletionTransaction(state, 1, 4)
    if (!tr) throw new Error('expected a deletion transaction')
    const next = state.apply(tr)
    expect(next.doc.textContent).toBe('abc')
    expect(next.doc.rangeHasMark(1, 4, delMark)).toBe(true)
  })

  it("removes the user's own insertion text", () => {
    const state = stateFrom([{ text: 'x' }, { text: 'yz', mark: 'insertion' }])
    const tr = deletionTransaction(state, 2, 4)
    if (!tr) throw new Error('expected a deletion transaction')
    expect(state.apply(tr).doc.textContent).toBe('x')
  })

  it('returns null when there is nothing to strike or remove', () => {
    const state = stateFrom([{ text: 'gone', mark: 'deletion' }])
    expect(deletionTransaction(state, 1, 5)).toBeNull()
  })
})
