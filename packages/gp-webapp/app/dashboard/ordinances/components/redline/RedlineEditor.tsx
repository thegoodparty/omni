'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Button } from '@styleguide'
import { CheckIcon, XMarkIcon } from '@styleguide/components/ui/icons'
import { DeletionMark, InsertionMark } from './redlineMarks'
import { docToMarkup, markupToDoc } from './redlineDoc'
import { RedlineSuggesting } from './redlineSuggesting'
import {
  changeRangeAt,
  resolveChangeTransaction,
  type ChangeAction,
} from './redlineChanges'

interface RedlineEditorProps {
  // The draft body with {-/+} amendment markup.
  value: string
  onChange?: (markup: string) => void
  editable?: boolean
  // Suggesting mode: typed text becomes an insertion, deleting baseline text
  // strikes it. Only meaningful when editable.
  suggesting?: boolean
  // Accessible name for the editable region, exposed on the ProseMirror element
  // so it's reachable as a named textbox (the plain draft body relies on this).
  ariaLabel?: string
  // Show a hover Accept/Reject control at each redline change. Only for a new
  // ordinance authoring its draft — an amendment's redline is the deliverable,
  // so its host leaves this off.
  showChangeControls?: boolean
}

// The change the pointer is over, plus where to float its toolbar (viewport
// coords, so `position: fixed`).
interface HoveredChange {
  from: number
  to: number
  top: number
  left: number
}

// Renders an ordinance amendment as an inline redline (struck deletions,
// underlined insertions) using the shared markup parser. Statute-only styling:
// the rich-text formatting StarterKit ships (headings, lists, bold, etc.) is
// disabled so the editor stays plain legislative text plus the two redline
// marks. With `suggesting`, editing tracks changes in place: typed text becomes
// an insertion and deleting baseline text strikes it (first pass: typing over a
// selection replaces rather than strikes, and paste isn't tracked yet). With
// `showChangeControls`, hovering a change offers per-change Accept/Reject.
export const RedlineEditor = ({
  value,
  onChange,
  editable = true,
  suggesting = false,
  ariaLabel,
  showChangeControls = false,
}: RedlineEditorProps) => {
  const editor = useEditor({
    editable,
    // Required under Next SSR: defer creation to the client to avoid a
    // hydration mismatch.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
        ...(editable ? {} : { 'aria-readonly': 'true' }),
      },
    },
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
      ...(suggesting ? [RedlineSuggesting] : []),
    ],
    content: markupToDoc(value),
    onUpdate: ({ editor: e }) => onChange?.(docToMarkup(e.getJSON())),
  })

  // Keep editability in sync with the prop, e.g. the draft locks while the
  // quality loop runs. Mirror the lock into aria-readonly too (matching the
  // raw contentEditable this replaced); editorProps.attributes is fixed at
  // creation, so the live toggle has to be imperative.
  useEffect(() => {
    if (!editor) return
    editor.setEditable(editable)
    const dom = editor.view.dom
    if (editable) dom.removeAttribute('aria-readonly')
    else dom.setAttribute('aria-readonly', 'true')
  }, [editor, editable])

  const [change, setChange] = useState<HoveredChange | null>(null)
  const rafRef = useRef(0)
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // True while the pointer is over the floating toolbar. The editor's
  // mousemove still fires there (the event bubbles), and that point is not
  // over a change — without this guard it would schedule the hide and the
  // toolbar would vanish as the user reaches for it.
  const overToolbarRef = useRef(false)

  const cancelHide = useCallback((): void => {
    if (hideRef.current) {
      clearTimeout(hideRef.current)
      hideRef.current = null
    }
  }, [])
  // Grace delay so crossing the small gap from the change to its floating
  // toolbar doesn't flicker it away.
  const scheduleHide = useCallback((): void => {
    cancelHide()
    hideRef.current = setTimeout(() => setChange(null), 250)
  }, [cancelHide])

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (hideRef.current) clearTimeout(hideRef.current)
    },
    [],
  )

  // The toolbar is anchored to viewport coords, so a scroll (which fires no
  // mousemove) would leave it floating over the wrong line. Dismiss it on any
  // scroll; it reappears, repositioned, on the next hover. Capture phase so it
  // catches the draft's own scroll container, not just window.
  useEffect(() => {
    if (!showChangeControls) return
    const onScroll = (): void => setChange(null)
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [showChangeControls])

  // Any edit shifts positions, so the hovered range captured in `change` would
  // be stale. Dismiss the toolbar on every doc change (including our own
  // accept/reject dispatch); it reappears, re-derived, on the next hover.
  useEffect(() => {
    if (!editor) return
    const clear = (): void => setChange(null)
    editor.on('update', clear)
    return () => {
      editor.off('update', clear)
    }
  }, [editor])

  const onMouseMove = useCallback(
    (e: React.MouseEvent): void => {
      if (!editor || !showChangeControls || !editable) return
      if (rafRef.current) return
      const { clientX, clientY } = e
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        // Over the toolbar: leave the current change (and its toolbar) as-is.
        if (overToolbarRef.current) return
        const { view } = editor
        const at = view.posAtCoords({ left: clientX, top: clientY })
        const range = at && changeRangeAt(view.state, at.pos)
        if (!range) {
          scheduleHide()
          return
        }
        cancelHide()
        setChange((prev) => {
          if (prev && prev.from === range[0] && prev.to === range[1]) {
            return prev
          }
          const coords = view.coordsAtPos(range[0])
          return {
            from: range[0],
            to: range[1],
            top: coords.top,
            left: coords.left,
          }
        })
      })
    },
    [editor, showChangeControls, editable, scheduleHide, cancelHide],
  )

  const resolveChange = useCallback(
    (action: ChangeAction): void => {
      if (!editor || !change) return
      const tr = resolveChangeTransaction(
        editor.state,
        change.from,
        change.to,
        action,
      )
      if (tr) editor.view.dispatch(tr)
      cancelHide()
      setChange(null)
    },
    [editor, change, cancelHide],
  )

  // Leaving the editor must also cancel any pending mousemove rAF — otherwise
  // it runs after the pointer is gone, re-asserts the last change, and the
  // toolbar sticks until a scroll or edit clears it.
  const handleLeave = useCallback((): void => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    scheduleHide()
  }, [scheduleHide])

  return (
    <div
      className="relative"
      onMouseMove={showChangeControls ? onMouseMove : undefined}
      onMouseLeave={showChangeControls ? handleLeave : undefined}
    >
      <EditorContent
        editor={editor}
        className="text-base leading-relaxed text-foreground [&_.ProseMirror]:min-h-40 [&_.ProseMirror]:whitespace-pre-wrap [&_.ProseMirror]:outline-none"
      />
      {change ? (
        <div
          role="toolbar"
          aria-label="Change actions"
          className="fixed z-40 flex -translate-y-full items-center gap-1 rounded-full border border-border bg-card p-1 shadow-md"
          style={{ top: Math.max(8, change.top - 4), left: change.left }}
          onMouseEnter={() => {
            overToolbarRef.current = true
            cancelHide()
          }}
          onMouseLeave={() => {
            overToolbarRef.current = false
            scheduleHide()
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <Button
            type="button"
            size="small"
            onClick={() => resolveChange('accept')}
          >
            <CheckIcon className="size-3.5" aria-hidden />
            Accept
          </Button>
          <Button
            type="button"
            size="small"
            variant="outline"
            onClick={() => resolveChange('reject')}
          >
            <XMarkIcon className="size-3.5" aria-hidden />
            Reject
          </Button>
        </div>
      ) : null}
    </div>
  )
}
