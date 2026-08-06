'use client'

import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { DeletionMark, InsertionMark } from './redlineMarks'
import { docToMarkup, markupToDoc } from './redlineDoc'

interface RedlineEditorProps {
  // The draft body with {-/+} amendment markup.
  value: string
  onChange?: (markup: string) => void
  editable?: boolean
}

// Renders an ordinance amendment as an inline redline (struck deletions,
// underlined insertions) using the shared markup parser. Statute-only styling:
// the rich-text formatting StarterKit ships (headings, lists, bold, etc.) is
// disabled so the editor stays plain legislative text plus the two redline
// marks. Editing behaviour (suggesting mode) lands in a later slice; for now it
// renders the redline and round-trips the markup.
export const RedlineEditor = ({
  value,
  onChange,
  editable = true,
}: RedlineEditorProps) => {
  const editor = useEditor({
    editable,
    // Required under Next SSR: defer creation to the client to avoid a
    // hydration mismatch.
    immediatelyRender: false,
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
    content: markupToDoc(value),
    onUpdate: ({ editor: e }) => onChange?.(docToMarkup(e.getJSON())),
  })

  return (
    <EditorContent
      editor={editor}
      className="text-base leading-relaxed text-foreground [&_.ProseMirror]:whitespace-pre-wrap [&_.ProseMirror]:outline-none"
    />
  )
}
