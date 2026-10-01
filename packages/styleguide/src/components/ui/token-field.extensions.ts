import { Extension, Mark, Node } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Dropcursor, UndoRedo } from '@tiptap/extensions'

import { cn } from '@styleguide/lib/utils'
import { tokenPillClassName } from './token-pill'
import {
  PROTECTED_MARK,
  TOKEN_NODE,
  guardTransaction,
  lockedRanges,
  stripProtected,
} from './token-field.model'

// A merge tag. An inline atom, so the caret steps over it and one backspace
// takes the whole thing; whether that backspace is allowed is the guard's
// call, not the node's.
export const TokenNode = Node.create({
  name: TOKEN_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  // Every attribute round-trips through the pill's HTML, because copy and
  // paste re-parse that HTML: a pill that only carried its id would paste
  // back with no merge-tag text and drop out of the message.
  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-token-id') ?? '',
      },
      label: {
        default: '',
        parseHTML: (element) => element.textContent ?? '',
      },
      text: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-token-text') ?? '',
      },
      required: {
        default: false,
        parseHTML: (element) =>
          element.getAttribute('data-token-required') === 'true',
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-token-id]' }]
  },
  renderHTML({ node }) {
    return [
      'span',
      {
        'data-token-id': node.attrs.id,
        'data-token-text': node.attrs.text,
        'data-token-required': String(node.attrs.required),
        class: cn(tokenPillClassName, 'mx-0.5 cursor-grab align-baseline'),
        contenteditable: 'false',
      },
      String(node.attrs.label),
    ]
  },
  // What a copy puts on the clipboard, and what the recipient gets.
  renderText({ node }) {
    return String(node.attrs.text)
  },
})

// A protected span. Deliberately no styling at rest: the text reads as the
// ordinary message text it is. `inclusive: false` keeps typing at either edge
// out of the span, and there is no `parseHTML`, so pasted markup can never
// mint protection. Only the caller's `protectedRanges` do.
export const ProtectedMark = Mark.create({
  name: PROTECTED_MARK,
  inclusive: false,
  addAttributes() {
    return { id: { default: '' } }
  },
  parseHTML() {
    return []
  },
  renderHTML({ mark }) {
    return ['span', { 'data-protected-id': mark.attrs.id }, 0]
  },
})

// Shake plus tint on whatever the blocked edit ran into. Decorations rather
// than a class set by hand on the DOM, because ProseMirror owns that DOM and
// redraws a node whose attributes change under it.
//
// `inline-block` is what lets a transform move inline text at all. It also
// reflows the span for the 0.4s it is applied, which is acceptable on the
// short phrases this protects. `motion-safe:` is the component guarding its
// own animation (tailwind-theme.css): under reduced motion the tint stays.
export const BLOCKED_CLASS =
  'inline-block motion-safe:animate-shake text-destructive!'

export const blockedKey = new PluginKey<DecorationSet>('tokenFieldBlocked')

const blockedDecorations = (
  doc: Parameters<typeof lockedRanges>[0],
  id: string,
): DecorationSet =>
  DecorationSet.create(
    doc,
    lockedRanges(doc)
      .filter((range) => range.id === id)
      .map((range) =>
        range.kind === 'token'
          ? Decoration.node(range.from, range.to, { class: BLOCKED_CLASS })
          : Decoration.inline(range.from, range.to, { class: BLOCKED_CLASS }),
      ),
  )

// The drag preview for a pill. Left to the browser, it is a snapshot of the
// selection, which Chrome paints on an opaque white box, and it is anchored
// where the pill was grabbed, so it sits on top of the drop cursor that is
// meant to show where it will land. A clone of just the pill, on a transparent
// wrapper whose padding offsets it below and right of the pointer, keeps the
// pill recognisable and the drop cursor in view.
const DRAG_PREVIEW_OFFSET_PX = 14

// A drag that starts on an already-selected pill (the one just dropped, say)
// is a selection drag, and Chrome then reports the pill's TEXT node as the
// target rather than the pill. So the pill is found from the target's parent,
// and failing that from the selection ProseMirror is about to drag.
const draggedPill = (view: EditorView, event: DragEvent): Element | null => {
  const target = event.target
  const element =
    target instanceof Element
      ? target
      : target instanceof globalThis.Node
        ? target.parentElement
        : null
  const fromTarget = element?.closest('[data-token-id]')
  if (fromTarget) return fromTarget
  const { selection } = view.state
  if (
    selection instanceof NodeSelection &&
    selection.node.type.name === TOKEN_NODE
  ) {
    const dom = view.nodeDOM(selection.from)
    return dom instanceof Element ? dom : null
  }
  return null
}

const setPillDragImage = (view: EditorView, event: DragEvent): void => {
  const pill = draggedPill(view, event)
  if (!pill || !event.dataTransfer) return
  const preview = document.createElement('div')
  preview.style.cssText = [
    'position: fixed',
    'top: -1000px',
    'left: -1000px',
    'background: transparent',
    `padding: ${DRAG_PREVIEW_OFFSET_PX}px 0 0 ${DRAG_PREVIEW_OFFSET_PX}px`,
    'pointer-events: none',
  ].join(';')
  const clone = pill.cloneNode(true)
  // A selected pill carries ProseMirror's selection class; the preview should
  // look like the pill at rest, not like the selection it came from.
  if (clone instanceof Element)
    clone.classList.remove('ProseMirror-selectednode')
  preview.appendChild(clone)
  document.body.appendChild(preview)
  event.dataTransfer.setDragImage(preview, 0, 0)
  // The browser snapshots the preview during dragstart; it can go after.
  setTimeout(() => preview.remove(), 0)
}

interface GuardOptions {
  // Called once per blocked edit with the id of what it ran into.
  onBlocked: (id: string) => void
}

export const TokenFieldGuard = Extension.create<GuardOptions>({
  name: 'tokenFieldGuard',
  addOptions() {
    return { onBlocked: () => undefined }
  },
  addProseMirrorPlugins() {
    const { onBlocked } = this.options
    let view: EditorView | null = null
    return [
      new Plugin({
        view(editorView) {
          view = editorView
          return {
            destroy() {
              view = null
            },
          }
        },
        props: {
          transformPasted: (slice) => stripProtected(slice),
          handleDOMEvents: {
            dragstart: (view, event) => {
              setPillDragImage(view, event)
              // ProseMirror still runs its own dragstart, which carries the
              // node; this only replaces what the pointer shows.
              return false
            },
          },
        },
        // A filter can only accept or reject, so the part of a blocked edit
        // that may go ahead is dispatched after it, from the state it was
        // computed against. If anything else landed first, it is dropped
        // rather than applied to a document it was not built for.
        filterTransaction(tr, state) {
          const blocked = guardTransaction(state, tr)
          if (!blocked) return true
          queueMicrotask(() => {
            if (!view) return
            if (blocked.replacement && view.state === state) {
              view.dispatch(blocked.replacement)
            }
            onBlocked(blocked.id)
          })
          return false
        },
      }),
      new Plugin<DecorationSet>({
        key: blockedKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(blockedKey) as string | null | undefined
            if (meta === undefined) return set.map(tr.mapping, tr.doc)
            return meta === null
              ? DecorationSet.empty
              : blockedDecorations(tr.doc, meta)
          },
        },
        props: {
          decorations: (state) => blockedKey.getState(state),
        },
      }),
    ]
  },
})

// The whole schema: plain paragraphs of text, tokens and protected spans, and
// undo. No bold, lists or headings, because an SMS or a spoken script has
// none, and a list button inserts plain characters rather than a list node.
//
// The drop cursor is a caret that follows the pointer while a pill is being
// dragged, so where it will land is visible before it is let go, including
// whether that is inside a phrase that will refuse it.
export const tokenFieldExtensions = (options: GuardOptions) => [
  Document,
  Paragraph,
  Text,
  UndoRedo,
  Dropcursor.configure({ color: 'var(--color-primary)', width: 2 }),
  TokenNode,
  ProtectedMark,
  TokenFieldGuard.configure(options),
]
