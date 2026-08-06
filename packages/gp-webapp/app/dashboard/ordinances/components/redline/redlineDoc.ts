import { parseRedline, type RedlineSegmentType } from '@goodparty_org/contracts'

// Conversion between the stored {-/+} amendment markup and the ProseMirror doc
// the TipTap editor edits. Kept pure and separate from the React editor so the
// round-trip is unit-testable. docToMarkup(markupToDoc(x)) === x for any body
// whose markers don't span a line break (the normal case), so an unedited load
// never churns the body or stales the quality-report hash. A marker that does
// span a newline canonicalizes to one marker per line — ProseMirror can't hold
// a mark across a paragraph boundary — which is idempotent and only persists if
// the user later edits and saves.

// Minimal ProseMirror JSON shapes. Structurally a subtype of TipTap's
// JSONContent, so markupToDoc feeds setContent and docToMarkup reads getJSON()
// without an `any`.
export interface RedlineTextNode {
  type: 'text'
  text: string
  marks?: { type: string }[]
}
export interface RedlineParagraph {
  type: 'paragraph'
  content?: RedlineTextNode[]
}
export interface RedlineDoc {
  type: 'doc'
  content: RedlineParagraph[]
}

// Loose shape for reading editor.getJSON() back; TipTap's JSONContent (which has
// more optional fields) is assignable to it.
export interface RedlineJsonNode {
  content?: RedlineJsonNode[]
  text?: string
  marks?: { type: string }[]
}

const markName = (type: RedlineSegmentType): string | null =>
  type === 'insertion' ? 'insertion' : type === 'deletion' ? 'deletion' : null

// Text is placed directly into text nodes (never parsed from HTML) so statute
// indentation and internal spacing survive exactly. Paragraphs are split on
// newlines, so a marker spanning a line break yields one marked node per line.
export const markupToDoc = (body: string): RedlineDoc => {
  const lines: RedlineTextNode[][] = []
  let current: RedlineTextNode[] = []
  lines.push(current)
  for (const seg of parseRedline(body)) {
    const mark = markName(seg.type)
    seg.text.split('\n').forEach((part, idx) => {
      if (idx > 0) {
        current = []
        lines.push(current)
      }
      if (part) {
        current.push(
          mark
            ? { type: 'text', text: part, marks: [{ type: mark }] }
            : { type: 'text', text: part },
        )
      }
    })
  }
  return {
    type: 'doc',
    content: lines.map((nodes) =>
      nodes.length
        ? { type: 'paragraph', content: nodes }
        : { type: 'paragraph' },
    ),
  }
}

const nodeToMarkup = (node: RedlineJsonNode): string => {
  const text = node.text ?? ''
  const mark = node.marks?.[0]?.type
  if (mark === 'insertion') return `{+${text}+}`
  if (mark === 'deletion') return `{-${text}-}`
  return text
}

// Serialize the editor doc back to {-/+} markup; each paragraph becomes a line.
export const docToMarkup = (doc: RedlineJsonNode): string =>
  (doc.content ?? [])
    .map((para) => (para.content ?? []).map(nodeToMarkup).join(''))
    .join('\n')
