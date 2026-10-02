'use client'

import * as React from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'

import { cn } from '@styleguide/lib/utils'
import { textareaVariants } from './textarea'
import { blockedKey, tokenFieldExtensions } from './token-field.extensions'
import {
  SKIP_GUARD_META,
  TOKEN_NODE,
  docToValue,
  valueToContent,
  type ProtectedSpec,
  type TokenSpec,
} from './token-field.model'

// How long the shake and tint stay on. Matches `--animate-shake` (0.4s) with
// a little room, and is a timer rather than `animationend` because under
// reduced motion there is no animation to end but the tint still has to go.
const BLOCKED_MS = 450

interface TokenFieldProps {
  // The flat message, tokens as their `text`. Fully controlled.
  value: string
  onChange: (value: string) => void
  // The tags this field recognises in `value` and can insert.
  tokens?: TokenSpec[]
  // Phrases the user can write around but not change.
  protectedRanges?: ProtectedSpec[]
  // Fired on a blocked edit. The field owns the shake and the tint; the
  // caller owns the message, so no copy lives in the styleguide. Render it in
  // a `role="status"` region: a shake and a colour are invisible to a screen
  // reader, and colour alone carrying meaning fails WCAG 1.4.1.
  onBlockedEdit?: (target: TokenSpec | ProtectedSpec) => void
  placeholder?: string
  // As a textarea's: the most characters the value may hold, tokens counted
  // as their text.
  maxLength?: number
  readOnly?: boolean
  // As `Textarea`'s: `seamless` for a field that is the content of a card.
  variant?: 'default' | 'seamless'
  className?: string
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  ref?: React.Ref<TokenFieldRef>
}

interface TokenFieldRef {
  insertToken: (id: string) => void
  // Plain characters, newlines included. A list button inserts `• ` through
  // this rather than a list node, because in an SMS a bullet is a character.
  insertText: (text: string) => void
  focus: () => void
}

// A textarea that understands two kinds of protected content, and must not
// pretend they are the same:
//
// - A token is a placeholder (`{first_name}`). What is on screen differs from
//   what is delivered, so it renders as a pill. It can be moved; a required
//   one cannot be deleted.
// - A protected span is literal final text (`Reply STOP to opt out.`). It is
//   delivered as it reads, so it renders as ordinary text with no treatment
//   at all, and reveals itself only when an edit runs into it.
//
// The value in and out is the same flat string a textarea would hold, so the
// validators and the vendors that read it do not change.
function TokenField({
  value,
  onChange,
  tokens = [],
  protectedRanges = [],
  onBlockedEdit,
  placeholder,
  maxLength,
  readOnly = false,
  variant = 'default',
  className,
  id,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  ref,
}: TokenFieldProps) {
  // The editor is built once, so everything it calls back into is read
  // through refs rather than captured.
  const latest = React.useRef({
    onChange,
    onBlockedEdit,
    tokens,
    protectedRanges,
    maxLength,
  })
  latest.current = {
    onChange,
    onBlockedEdit,
    tokens,
    protectedRanges,
    maxLength,
  }
  // What the field last reported. A `value` equal to it is the field's own
  // edit coming back round, not a new message to load.
  const emitted = React.useRef(value)
  // Order-independent, so the same specs passed in a different order (an
  // unsorted server list) do not rebuild the document.
  const byId = <T extends { id: string }>(specs: T[]) =>
    [...specs].sort((a, b) => a.id.localeCompare(b.id))
  // Only what goes into the document. A phrase's `reason` is read at
  // blocked-edit time and never rendered, so a new reason must not rebuild
  // the message (and lose undo history) on its own.
  const specKey = JSON.stringify([
    byId(tokens).map(({ id, label, text, required = false }) => ({
      id,
      label,
      text,
      required,
    })),
    byId(protectedRanges).map(({ id, text, start }) => ({ id, text, start })),
  ])
  const loadedSpecKey = React.useRef(specKey)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const frame = React.useRef(0)
  const editorRef = React.useRef<ReturnType<typeof useEditor>>(null)

  const onBlocked = React.useCallback((blockedId: string) => {
    const editor = editorRef.current
    if (!editor) return
    const {
      tokens: specs,
      protectedRanges: spans,
      onBlockedEdit: report,
    } = latest.current
    const target =
      spans.find((span) => span.id === blockedId) ??
      specs.find((token) => token.id === blockedId)
    if (target) report?.(target)
    // Off, then on in the next frame, so a second blocked edit mid-shake
    // restarts the animation instead of being swallowed by the first.
    if (timer.current) clearTimeout(timer.current)
    cancelAnimationFrame(frame.current)
    editor.view.dispatch(editor.state.tr.setMeta(blockedKey, null))
    frame.current = requestAnimationFrame(() => {
      if (editor.isDestroyed) return
      editor.view.dispatch(editor.state.tr.setMeta(blockedKey, blockedId))
      timer.current = setTimeout(() => {
        if (!editor.isDestroyed) {
          editor.view.dispatch(editor.state.tr.setMeta(blockedKey, null))
        }
      }, BLOCKED_MS)
    })
  }, [])

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      cancelAnimationFrame(frame.current)
    },
    [],
  )

  // The accessible textbox is the editable element itself, so its name,
  // state and styling go on it. Given at creation so the first paint is
  // already labelled and styled, then kept in sync by the effect below,
  // because `editorProps.attributes` is not re-read on its own.
  const attributes = React.useMemo(
    () => ({
      role: 'textbox',
      'aria-multiline': 'true',
      ...(id ? { id } : {}),
      ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      ...(ariaLabelledBy ? { 'aria-labelledby': ariaLabelledBy } : {}),
      ...(ariaDescribedBy ? { 'aria-describedby': ariaDescribedBy } : {}),
      ...(ariaInvalid ? { 'aria-invalid': 'true' } : {}),
      ...(readOnly ? { 'aria-readonly': 'true' } : {}),
      ...(placeholder ? { 'aria-placeholder': placeholder } : {}),
      class: cn(
        textareaVariants(variant),
        'block min-h-16 whitespace-pre-wrap break-words',
        className,
      ),
    }),
    [
      id,
      ariaLabel,
      ariaLabelledBy,
      ariaDescribedBy,
      ariaInvalid,
      readOnly,
      placeholder,
      variant,
      className,
    ],
  )

  const editor = useEditor({
    // Required under Next SSR: create on the client to avoid a hydration
    // mismatch.
    immediatelyRender: false,
    editable: !readOnly,
    extensions: tokenFieldExtensions({
      onBlocked,
      maxLength: () => latest.current.maxLength,
    }),
    content: valueToContent(value, tokens, protectedRanges),
    editorProps: { attributes },
    onUpdate: ({ editor: current }) => {
      const next = docToValue(current.state.doc)
      if (next === emitted.current) return
      emitted.current = next
      latest.current.onChange(next)
    },
  })
  editorRef.current = editor

  React.useEffect(() => {
    if (!editor) return
    editor.setOptions({ editorProps: { attributes } })
  }, [editor, attributes])

  React.useEffect(() => {
    if (!editor) return
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  // A new message from outside (a fresh draft, a reset), or a change in what
  // is locked: rebuild the document. This is the one write the guard lets
  // through unchecked, and it stays out of undo history.
  React.useEffect(() => {
    if (!editor) return
    if (value === emitted.current && specKey === loadedSpecKey.current) return
    emitted.current = value
    loadedSpecKey.current = specKey
    const doc = editor.schema.nodeFromJSON(
      valueToContent(value, tokens, protectedRanges),
    )
    editor.view.dispatch(
      editor.state.tr
        .replaceWith(0, editor.state.doc.content.size, doc.content)
        .setMeta(SKIP_GUARD_META, true)
        .setMeta('addToHistory', false)
        .setMeta('preventUpdate', true),
    )
    // `tokens` and `protectedRanges` are covered by `specKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, value, specKey])

  React.useImperativeHandle(
    ref,
    () => ({
      insertToken: (tokenId) => {
        const spec = latest.current.tokens.find((token) => token.id === tokenId)
        if (!editor || !spec) return
        const { id: specId, label, text, required = false } = spec
        editor
          .chain()
          .focus()
          .insertContent({
            type: TOKEN_NODE,
            attrs: { id: specId, label, text, required },
          })
          .run()
      },
      insertText: (text) => {
        if (!editor || text.length === 0) return
        editor.commands.focus()
        // A line break splits the line the cursor is on, as Enter would.
        // Inserting whole paragraphs instead also severs the text around
        // the cursor into lines of their own. One transaction, so the
        // cursor is mapped through each step.
        const tr = editor.state.tr
        text.split('\n').forEach((line, index) => {
          if (index > 0) tr.split(tr.selection.from)
          if (line.length > 0) tr.insertText(line)
        })
        editor.view.dispatch(tr.scrollIntoView())
      },
      focus: () => {
        editor?.commands.focus()
      },
    }),
    [editor],
  )

  const isEmpty = useEditorState({
    editor,
    selector: ({ editor: current }) => current?.isEmpty ?? value.length === 0,
  })

  return (
    <div data-slot="token-field" className="relative w-full">
      <EditorContent editor={editor} />
      {placeholder && isEmpty && (
        // Drawn over the empty field rather than inside it, so it can never
        // become part of the document. The textbox carries it as
        // `aria-placeholder` for assistive tech.
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0 text-base text-muted-foreground md:text-sm',
            variant === 'seamless'
              ? 'p-0'
              : 'border border-transparent px-3 py-2',
          )}
        >
          {placeholder}
        </div>
      )}
    </div>
  )
}

export { TokenField, type TokenFieldProps, type TokenFieldRef }
export type { ProtectedSpec, TokenSpec } from './token-field.model'
