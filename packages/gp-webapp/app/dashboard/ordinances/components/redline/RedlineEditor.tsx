'use client'

import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { DeletionMark, InsertionMark } from './redlineMarks'
import { docToMarkup, markupToDoc } from './redlineDoc'
import { RedlineSuggesting } from './redlineSuggesting'

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
}

// Renders an ordinance amendment as an inline redline (struck deletions,
// underlined insertions) using the shared markup parser. Statute-only styling:
// the rich-text formatting StarterKit ships (headings, lists, bold, etc.) is
// disabled so the editor stays plain legislative text plus the two redline
// marks. With `suggesting`, editing tracks changes in place: typed text becomes
// an insertion and deleting baseline text strikes it (first pass: typing over a
// selection replaces rather than strikes, and paste isn't tracked yet).
export const RedlineEditor = ({
  value,
  onChange,
  editable = true,
  suggesting = false,
  ariaLabel,
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

  return (
    <EditorContent
      editor={editor}
      className="text-base leading-relaxed text-foreground [&_.ProseMirror]:min-h-40 [&_.ProseMirror]:whitespace-pre-wrap [&_.ProseMirror]:outline-none"
    />
  )
}
