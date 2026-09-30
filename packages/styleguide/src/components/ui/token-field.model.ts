import type { JSONContent } from '@tiptap/core'
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import {
  Selection,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'

// The pure half of `TokenField`: turning the flat string the caller owns into
// an editor document and back, and deciding whether an edit may touch the
// parts of that document the caller has locked. Kept free of React and of a
// live editor view so every rule here is testable against a bare
// `EditorState`, the way `redlineSuggesting.ts` is.

// A placeholder. It renders as a pill because what the pill shows differs
// from what the recipient receives.
export interface TokenSpec {
  id: string
  // What the pill shows.
  label: string
  // What it serializes to, verbatim, e.g. `{first_name}`.
  text: string
  // Cannot be deleted. It can still be moved.
  required?: boolean
}

// Literal final text the user may write around but not inside. It has no
// resting treatment: it renders as ordinary text, never a pill, because it is
// delivered exactly as it reads.
export interface ProtectedSpec {
  id: string
  // Matched and locked verbatim, at its first occurrence only.
  text: string
  // Why it is locked, for the caller to surface on a blocked edit. The field
  // never renders it, so no copy lives in the styleguide.
  reason: string
}

export const TOKEN_NODE = 'token'
export const PROTECTED_MARK = 'protectedText'
// Set on the field's own programmatic rewrites (a new `value` from the
// caller) so the guard does not read a fresh document as an edit.
export const SKIP_GUARD_META = 'tokenFieldSkipGuard'

interface Hit {
  start: number
  end: number
}

interface TokenHit extends Hit {
  spec: TokenSpec
}

interface ProtectedHit extends Hit {
  spec: ProtectedSpec
}

const overlaps = (a: Hit, b: Hit): boolean => a.start < b.end && a.end > b.start

// Every occurrence of every token in one line, longest token first so a
// token whose text contains another's is matched whole.
const findTokens = (line: string, tokens: readonly TokenSpec[]): TokenHit[] => {
  const byLength = tokens
    .filter((token) => token.text.length > 0)
    .sort((a, b) => b.text.length - a.text.length)
  const hits: TokenHit[] = []
  let index = 0
  while (index < line.length) {
    const spec = byLength.find((token) => line.startsWith(token.text, index))
    if (spec) {
      hits.push({ start: index, end: index + spec.text.length, spec })
      index += spec.text.length
    } else {
      index += 1
    }
  }
  return hits
}

const lineContent = (
  line: string,
  tokens: TokenHit[],
  anchors: ProtectedHit[],
): JSONContent[] => {
  const hits = [...tokens, ...anchors].sort((a, b) => a.start - b.start)
  const content: JSONContent[] = []
  let cursor = 0
  for (const hit of hits) {
    if (hit.start > cursor) {
      content.push({ type: 'text', text: line.slice(cursor, hit.start) })
    }
    if ('reason' in hit.spec) {
      content.push({
        type: 'text',
        text: hit.spec.text,
        marks: [{ type: PROTECTED_MARK, attrs: { id: hit.spec.id } }],
      })
    } else {
      const { id, label, text, required = false } = hit.spec
      content.push({ type: TOKEN_NODE, attrs: { id, label, text, required } })
    }
    cursor = hit.end
  }
  if (cursor < line.length) {
    content.push({ type: 'text', text: line.slice(cursor) })
  }
  return content
}

// One paragraph per line. Tokens are recognised wherever they appear; each
// protected span is anchored to its FIRST occurrence only, because the
// validators it mirrors need one match anywhere. A second copy the user types
// is plain text and theirs to delete.
export const valueToContent = (
  value: string,
  tokens: readonly TokenSpec[] = [],
  protectedRanges: readonly ProtectedSpec[] = [],
): JSONContent => {
  const lines = value.split('\n')
  const tokenHits = lines.map((line) => findTokens(line, tokens))
  const anchors: ProtectedHit[][] = lines.map(() => [])

  for (const spec of protectedRanges) {
    // A span cannot cross a line, and an empty one protects nothing.
    if (spec.text.length === 0 || spec.text.includes('\n')) continue
    let placed = false
    for (let row = 0; row < lines.length && !placed; row += 1) {
      const line = lines[row] ?? ''
      let from = 0
      for (;;) {
        const start = line.indexOf(spec.text, from)
        if (start === -1) break
        const hit = { start, end: start + spec.text.length, spec }
        const taken = [...(tokenHits[row] ?? []), ...(anchors[row] ?? [])]
        if (!taken.some((other) => overlaps(hit, other))) {
          anchors[row]?.push(hit)
          placed = true
          break
        }
        from = start + 1
      }
    }
  }

  return {
    type: 'doc',
    content: lines.map((line, row) => {
      const content = lineContent(
        line,
        tokenHits[row] ?? [],
        anchors[row] ?? [],
      )
      return content.length > 0
        ? { type: 'paragraph', content }
        : { type: 'paragraph' }
    }),
  }
}

// Back to the flat string the caller, the validators and the vendor all
// read. A token becomes its `text`, so the wire format is unchanged.
export const docToValue = (doc: ProseMirrorNode): string => {
  const lines: string[] = []
  doc.forEach((block) => {
    let line = ''
    block.forEach((child) => {
      if (child.isText) line += child.text ?? ''
      else if (child.type.name === TOKEN_NODE) line += String(child.attrs.text)
    })
    lines.push(line)
  })
  return lines.join('\n')
}

export interface LockedRange {
  from: number
  to: number
  id: string
  kind: 'token' | 'protected'
}

// Everything an edit may not remove: each protected span (adjacent text
// nodes carrying the same id merged into one range) and each required token.
export const lockedRanges = (doc: ProseMirrorNode): LockedRange[] => {
  const ranges: LockedRange[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === TOKEN_NODE) {
      if (node.attrs.required) {
        ranges.push({
          from: pos,
          to: pos + node.nodeSize,
          id: String(node.attrs.id),
          kind: 'token',
        })
      }
      return false
    }
    if (!node.isText) return true
    const mark = node.marks.find((m) => m.type.name === PROTECTED_MARK)
    if (!mark) return false
    const id = String(mark.attrs.id)
    const last = ranges[ranges.length - 1]
    if (
      last &&
      last.kind === 'protected' &&
      last.id === id &&
      last.to === pos
    ) {
      last.to = pos + node.nodeSize
    } else {
      ranges.push({ from: pos, to: pos + node.nodeSize, id, kind: 'protected' })
    }
    return false
  })
  return ranges
}

interface Signature {
  protectedText: Map<string, string>
  requiredCount: Map<string, number>
}

const signature = (doc: ProseMirrorNode): Signature => {
  const protectedText = new Map<string, string>()
  const requiredCount = new Map<string, number>()
  doc.descendants((node) => {
    if (node.type.name === TOKEN_NODE) {
      if (node.attrs.required) {
        const id = String(node.attrs.id)
        requiredCount.set(id, (requiredCount.get(id) ?? 0) + 1)
      }
      return false
    }
    if (!node.isText) return true
    const mark = node.marks.find((m) => m.type.name === PROTECTED_MARK)
    if (mark) {
      const id = String(mark.attrs.id)
      protectedText.set(id, (protectedText.get(id) ?? '') + (node.text ?? ''))
    }
    return false
  })
  return { protectedText, requiredCount }
}

// The id of the first locked thing `after` got wrong, or null if the edit
// kept every one of them. Comparing outcomes rather than inspecting steps is
// what makes this one check cover every way in: typing, backspace, delete,
// cut, paste-over, drag-out and undo.
//
// A protected span must read exactly as it did. Text typed inside one
// inherits its mark and changes it, so that fails too. A required token may
// move or be duplicated but never drop below its count.
export const findViolation = (
  before: ProseMirrorNode,
  after: ProseMirrorNode,
): string | null => {
  const was = signature(before)
  const now = signature(after)
  for (const [id, text] of was.protectedText) {
    if (now.protectedText.get(id) !== text) return id
  }
  for (const id of now.protectedText.keys()) {
    if (!was.protectedText.has(id)) return id
  }
  for (const [id, count] of was.requiredCount) {
    if ((now.requiredCount.get(id) ?? 0) < count) return id
  }
  return null
}

const stripFragment = (fragment: Fragment): Fragment => {
  const nodes: ProseMirrorNode[] = []
  fragment.forEach((node) => {
    nodes.push(
      node.isText
        ? node.mark(node.marks.filter((m) => m.type.name !== PROTECTED_MARK))
        : node.copy(stripFragment(node.content)),
    )
  })
  return Fragment.fromArray(nodes)
}

// Pasted or dropped content never carries protection with it. Only the
// caller decides what is locked; a copy of a locked phrase is plain text.
export const stripProtected = (slice: Slice): Slice =>
  new Slice(stripFragment(slice.content), slice.openStart, slice.openEnd)

// The parts of [from, to) no locked range covers.
const freeRanges = (
  from: number,
  to: number,
  locked: LockedRange[],
): { from: number; to: number }[] => {
  const inside = locked
    .filter((range) => range.from < to && range.to > from)
    .sort((a, b) => a.from - b.from)
  const free: { from: number; to: number }[] = []
  let cursor = from
  for (const range of inside) {
    if (range.from > cursor) free.push({ from: cursor, to: range.from })
    cursor = Math.max(cursor, range.to)
  }
  if (cursor < to) free.push({ from: cursor, to })
  return free
}

// Removes the free text in one range. A range that crosses a line break
// clears each line's share and keeps the break, so what survives stays on
// the lines it was on.
const clearRange = (
  tr: Transaction,
  { from, to }: { from: number; to: number },
  { keepSpace }: { keepSpace: boolean },
): void => {
  const $from = tr.doc.resolve(from)
  const $to = tr.doc.resolve(to)
  if ($from.sameParent($to)) {
    if (keepSpace) tr.insertText(' ', from, to)
    else tr.delete(from, to)
    return
  }
  if (to > $to.start()) tr.delete($to.start(), to)
  if ($from.after() < $to.before()) tr.delete($from.after(), $to.before())
  if (from < $from.end()) tr.delete(from, $from.end())
}

export interface BlockedEdit {
  // The locked thing the edit ran into, for the shake and the message.
  id: string
  // The part of the edit that may go ahead, or null if none of it can.
  replacement: Transaction | null
}

// Null lets the transaction through. Otherwise the edit is blocked, and where
// it was a single replace that swept a locked range up with free text (the
// common case: select everything and start typing), the replacement applies
// the free part and leaves each locked range in place. Rejecting the whole
// edit there would make the field look broken.
export const guardTransaction = (
  state: EditorState,
  tr: Transaction,
): BlockedEdit | null => {
  if (!tr.docChanged || tr.getMeta(SKIP_GUARD_META)) return null
  const id = findViolation(state.doc, tr.doc)
  if (id === null) return null

  const [step, ...rest] = tr.steps
  // A pure insertion that tripped the guard landed inside a protected span;
  // there is nothing free to keep.
  if (
    rest.length > 0 ||
    !(step instanceof ReplaceStep) ||
    step.from === step.to
  ) {
    return { id, replacement: null }
  }

  const locked = lockedRanges(state.doc)
  // Select-all starts before the first line and ends after the last. Pull
  // the ends onto text, or the typed text would land as a new line.
  const from = Selection.findFrom(state.doc.resolve(step.from), 1, true)?.from
  const to = Selection.findFrom(state.doc.resolve(step.to), -1, true)?.to
  if (from === undefined || to === undefined || from >= to) {
    return { id, replacement: null }
  }
  const free = freeRanges(from, to, locked)
  const [first] = free
  if (!first) return { id, replacement: null }
  const isLockedStart = (pos: number) => locked.some((r) => r.from === pos)
  const isLockedEnd = (pos: number) => locked.some((r) => r.to === pos)

  const replacement = state.tr
  // Last to first, so each deletion leaves the positions before it valid.
  for (const range of [...free].reverse()) {
    clearRange(replacement, range, {
      // Two locked parts the edit swept the text from between keep a space,
      // or they read as one word ("Paid for byFriends of Sam").
      keepSpace:
        range !== first && isLockedEnd(range.from) && isLockedStart(range.to),
    })
  }
  // Opened as far as it goes, so a slice that arrives wrapped in a whole
  // paragraph (select-all replaces the document's content) merges into the
  // line it lands on instead of splitting it.
  const slice = Slice.maxOpen(stripProtected(step.slice).content)
  if (slice.size > 0) {
    const before = replacement.steps.length
    replacement.replace(first.from, first.from, slice)
    const end = replacement.mapping.slice(before).map(first.from, 1)
    const sameLine = state.doc
      .resolve(first.from)
      .sameParent(state.doc.resolve(first.to))
    if (sameLine && isLockedStart(first.to)) replacement.insertText(' ', end)
    replacement.setSelection(
      TextSelection.near(replacement.doc.resolve(end), -1),
    )
  }
  if (findViolation(state.doc, replacement.doc) !== null) {
    return { id, replacement: null }
  }
  return { id, replacement }
}
