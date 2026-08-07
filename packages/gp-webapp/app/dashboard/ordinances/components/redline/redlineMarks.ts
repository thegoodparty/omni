import { Mark, mergeAttributes } from '@tiptap/core'

// Amendment insertions: rendered as <ins> (browser-underlined) tinted with the
// success token. The mark round-trips to {+...+} via redlineDoc.
export const InsertionMark = Mark.create({
  name: 'insertion',
  parseHTML() {
    return [{ tag: 'ins' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'ins',
      mergeAttributes(HTMLAttributes, {
        class: 'text-success decoration-success/60',
      }),
      0,
    ]
  },
})

// Amendment deletions: rendered as <del> (browser strike-through) tinted with
// the destructive token. Round-trips to {-...-}.
export const DeletionMark = Mark.create({
  name: 'deletion',
  parseHTML() {
    return [{ tag: 'del' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'del',
      mergeAttributes(HTMLAttributes, {
        class: 'text-destructive decoration-destructive/60',
      }),
      0,
    ]
  },
})
