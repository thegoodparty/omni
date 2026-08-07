import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { DeletionMark, InsertionMark } from './redlineMarks'
import { docToMarkup, markupToDoc } from './redlineDoc'
import { changeRangeAt, resolveChangeTransaction } from './redlineChanges'

// Mirrors RedlineEditor's schema so positions and marks line up with runtime.
const makeEditor = (markup: string): Editor =>
  new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        bold: false,
        italic: false,
        strike: false,
      }),
      InsertionMark,
      DeletionMark,
    ],
    content: markupToDoc(markup),
  })

// First position sitting inside a redline-marked text node.
const firstRedlinePos = (editor: Editor): number => {
  const { insertion, deletion } = editor.state.schema.marks
  let pos = -1
  editor.state.doc.descendants((node, at) => {
    if (pos !== -1 || !node.isText) return
    if (insertion?.isInSet(node.marks) || deletion?.isInSet(node.marks)) {
      pos = at + 1
    }
  })
  return pos
}

const resolve = (markup: string, action: 'accept' | 'reject'): string => {
  const editor = makeEditor(markup)
  const range = changeRangeAt(editor.state, firstRedlinePos(editor))
  if (!range) throw new Error('no change found')
  const tr = resolveChangeTransaction(editor.state, range[0], range[1], action)
  if (!tr) throw new Error('no transaction')
  const next = editor.state.apply(tr)
  const markupOut = docToMarkup(next.doc.toJSON())
  editor.destroy()
  return markupOut
}

describe('changeRangeAt', () => {
  it('groups an adjacent {-old-}{+new+} pair into one change range', () => {
    // Accepting the whole range yields the inserted text, proving the range
    // spanned both the deletion and the insertion.
    expect(resolve('The fee is {-$50-}{+$75+}.', 'accept')).toBe(
      'The fee is $75.',
    )
  })

  it('returns null for a position in unchanged text', () => {
    const editor = makeEditor('Plain text, no changes.')
    expect(changeRangeAt(editor.state, 2)).toBeNull()
    editor.destroy()
  })
})

describe('resolveChangeTransaction', () => {
  it('accepts a replacement: keep the insertion, drop the deletion', () => {
    expect(resolve('The fee is {-$50-}{+$75+}.', 'accept')).toBe(
      'The fee is $75.',
    )
  })

  it('rejects a replacement: keep the original, drop the insertion', () => {
    expect(resolve('The fee is {-$50-}{+$75+}.', 'reject')).toBe(
      'The fee is $50.',
    )
  })

  it('accepts a lone insertion by dropping its mark', () => {
    expect(resolve('a {+new+} b', 'accept')).toBe('a new b')
  })

  it('rejects a lone insertion by removing the text', () => {
    expect(resolve('a {+new+} b', 'reject')).toBe('a  b')
  })

  it('accepts a lone deletion by removing the struck text', () => {
    expect(resolve('a {-old-} b', 'accept')).toBe('a  b')
  })

  it('rejects a lone deletion by keeping the original text', () => {
    expect(resolve('a {-old-} b', 'reject')).toBe('a old b')
  })
})
