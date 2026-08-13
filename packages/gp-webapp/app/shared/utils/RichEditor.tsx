'use client'
import React, { useEffect } from 'react'
import { useQuill } from 'react-quilljs'
import 'quill/dist/quill.bubble.css'
import { cn } from '@styleguide'
import { noop } from './noop'

interface RichEditorProps {
  initialText?: string
  onChangeCallback?: (value: string, flag?: number) => void
  onTextLengthChange?: (length: number) => void
  useOnChange?: boolean
  // Renders the editor with a destructive border to flag a validation error.
  error?: boolean
  // Hides the Quill bubble formatting toolbar so the field behaves like a
  // plain-text input. The stored value is still Quill HTML, so it stays
  // readable/editable by surfaces that keep the toolbar (e.g. the website /
  // Pro-upgrade policy editor).
  hideToolbar?: boolean
  // Hard cap on typed text length. Enforced only for user edits (source
  // 'user'), so pre-existing longer content loaded into the editor is never
  // silently truncated — it just can't grow.
  maxLength?: number
}

const RichEditor = ({
  initialText = '',
  onChangeCallback = noop,
  onTextLengthChange,
  error = false,
  hideToolbar = false,
  maxLength,
}: RichEditorProps): React.JSX.Element => {
  const { quill, quillRef } = useQuill({
    theme: 'bubble',
    modules: hideToolbar ? { toolbar: false } : undefined,
  })

  useEffect(() => {
    if (quill && initialText) {
      quill.clipboard.dangerouslyPasteHTML(initialText)
      onTextLengthChange?.(quill.getText().trim().length)
    }
  }, [quill, initialText])

  useEffect(() => {
    if (quill) {
      const textChangeHandler = (
        _delta: unknown,
        _oldDelta: unknown,
        source?: string,
      ) => {
        // Quill's length includes a trailing newline, hence the +1.
        if (
          maxLength &&
          source === 'user' &&
          quill.getLength() > maxLength + 1
        ) {
          quill.deleteText(maxLength, quill.getLength())
        }
        const value = quill.root.innerHTML
        if (value) {
          onChangeCallback(value)
        }
        onTextLengthChange?.(quill.getText().trim().length)
      }

      const blurHandler = () => {
        const value = quill.root.innerHTML
        if (value) {
          onChangeCallback(value, 1)
        }
        onTextLengthChange?.(quill.getText().trim().length)
      }

      quill.on('text-change', textChangeHandler)
      quill.on('blur', blurHandler)

      return () => {
        quill.off('text-change', textChangeHandler)
        quill.off('blur', blurHandler)
      }
    }
    return undefined
  }, [quill, onChangeCallback, onTextLengthChange, maxLength])

  return (
    <div
      className={cn(
        'p-3 border rounded-lg [&>.quill>.ql-container]:text-base [&_.ql-editor]:wrap-anywhere',
        error ? 'border-destructive' : 'border-gray-200',
      )}
    >
      <div ref={quillRef} />
    </div>
  )
}

export default RichEditor
