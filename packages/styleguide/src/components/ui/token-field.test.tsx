import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/core'

import { TokenField, type TokenFieldRef } from './token-field'
import type { ProtectedSpec, TokenSpec } from './token-field.model'

const FIRST_NAME: TokenSpec = {
  id: 'first_name',
  label: 'First name',
  text: '{first_name}',
  required: true,
}
const OPT_OUT: ProtectedSpec = {
  id: 'opt_out',
  text: 'Reply STOP to opt out.',
  reason: 'Every text has to offer a way to opt out.',
}

// TipTap mounts on the client (immediatelyRender: false), so every test
// waits for the textbox, then reaches the editor the way its own extensions
// do: TipTap hangs it on the editable element.
const mount = async (
  props: Partial<React.ComponentProps<typeof TokenField>> = {},
) => {
  const onChange = vi.fn()
  const onBlockedEdit = vi.fn()
  const ref = React.createRef<TokenFieldRef>()
  const utils = render(
    <TokenField
      ref={ref}
      aria-label="Message body"
      value="Hi {first_name}. Reply STOP to opt out."
      onChange={onChange}
      onBlockedEdit={onBlockedEdit}
      tokens={[FIRST_NAME]}
      protectedRanges={[OPT_OUT]}
      {...props}
    />,
  )
  const box = await screen.findByRole('textbox', { name: 'Message body' })
  const editor = (box as HTMLElement & { editor: Editor }).editor
  return { ...utils, box, editor, onChange, onBlockedEdit, ref }
}

const positionOf = (editor: Editor, needle: string): number => {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1 || !node.isText) return
    const index = node.text?.indexOf(needle) ?? -1
    if (index !== -1) found = pos + index
  })
  return found
}

describe('TokenField', () => {
  it('renders a token as a pill showing its label, and the span as plain text', async () => {
    const { box } = await mount()
    expect(box.querySelector('[data-token-id="first_name"]')).toHaveTextContent(
      'First name',
    )
    // No resting treatment: the span carries only its id.
    const span = box.querySelector('[data-protected-id="opt_out"]')
    expect(span).toHaveTextContent('Reply STOP to opt out.')
    expect(span?.getAttribute('class')).toBeNull()
  })

  it('reports edits as the flat string, tokens back as their text', async () => {
    const { editor, onChange } = await mount()
    act(() => {
      editor.commands.insertContentAt(positionOf(editor, 'Reply'), 'Thanks! ')
    })
    expect(onChange).toHaveBeenLastCalledWith(
      'Hi {first_name}. Thanks! Reply STOP to opt out.',
    )
  })

  it('blocks an edit inside a protected span, and says which one', async () => {
    const { editor, onChange, onBlockedEdit } = await mount()
    const at = positionOf(editor, 'STOP')
    act(() => {
      editor.view.dispatch(editor.state.tr.delete(at, at + 1))
    })
    await waitFor(() => expect(onBlockedEdit).toHaveBeenCalledWith(OPT_OUT))
    expect(onChange).not.toHaveBeenCalled()
    expect(editor.getText()).toContain('Reply STOP to opt out.')
  })

  it('loads a new value from outside without reporting it back', async () => {
    const { editor, onChange, rerender } = await mount()
    rerender(
      <TokenField
        aria-label="Message body"
        value="Fresh draft. Reply STOP to opt out."
        onChange={onChange}
        tokens={[FIRST_NAME]}
        protectedRanges={[OPT_OUT]}
      />,
    )
    await waitFor(() => expect(editor.getText()).toContain('Fresh draft.'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not rebuild the message when the same specs arrive in another order', async () => {
    const NAME: ProtectedSpec = {
      id: 'candidate_name',
      text: 'Hi',
      reason: 'Your name.',
    }
    const { editor, onChange, rerender } = await mount({
      protectedRanges: [OPT_OUT, NAME],
    })
    const before = editor.state.doc
    rerender(
      <TokenField
        aria-label="Message body"
        value="Hi {first_name}. Reply STOP to opt out."
        onChange={onChange}
        tokens={[FIRST_NAME]}
        protectedRanges={[NAME, OPT_OUT]}
      />,
    )
    await act(async () => undefined)
    expect(editor.state.doc).toBe(before)
  })

  it('keeps undo history when only a reason changes', async () => {
    const { editor, onChange, rerender } = await mount()
    const before = editor.state.doc
    rerender(
      <TokenField
        aria-label="Message body"
        value="Hi {first_name}. Reply STOP to opt out."
        onChange={onChange}
        tokens={[FIRST_NAME]}
        protectedRanges={[{ ...OPT_OUT, reason: 'A newly fetched reason.' }]}
      />,
    )
    await act(async () => undefined)
    expect(editor.state.doc).toBe(before)
  })

  it('inserts multi-line text as a line break at the cursor, not extra lines', async () => {
    const { editor, ref, onChange } = await mount({
      value: 'Before after',
      protectedRanges: [],
    })
    act(() => {
      editor.commands.setTextSelection(positionOf(editor, ' after'))
    })
    act(() => ref.current?.insertText('• one\n• '))
    expect(onChange).toHaveBeenLastCalledWith('Before• one\n•  after')
  })

  it('inserts multi-line text beside a locked phrase, but never inside one', async () => {
    const { editor, ref, onChange, onBlockedEdit } = await mount({
      value: 'Vote Tuesday. Reply STOP to opt out.',
    })
    act(() => {
      editor.commands.setTextSelection(positionOf(editor, 'Reply'))
    })
    act(() => ref.current?.insertText('\n• '))
    expect(onChange).toHaveBeenLastCalledWith(
      'Vote Tuesday. \n• Reply STOP to opt out.',
    )

    onChange.mockClear()
    act(() => {
      editor.commands.setTextSelection(positionOf(editor, 'STOP') + 1)
    })
    act(() => ref.current?.insertText('x\ny'))
    await waitFor(() => expect(onBlockedEdit).toHaveBeenCalledWith(OPT_OUT))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps a pasted pill whole: its merge-tag text comes back with it', async () => {
    const { editor, box, onChange } = await mount({
      value: 'Hi {first_name}. Reply STOP to opt out.',
    })
    const pill = box.querySelector('[data-token-id="first_name"]')
    if (!pill) throw new Error('no pill')
    act(() => {
      editor.commands.setTextSelection(positionOf(editor, '. '))
      // Paste re-parses the copied HTML through the schema; insertContent
      // with an HTML string takes the same parse path (jsdom has no
      // ClipboardEvent for pasteHTML).
      editor.commands.insertContent(pill.outerHTML)
    })
    expect(onChange).toHaveBeenLastCalledWith(
      'Hi {first_name}{first_name}. Reply STOP to opt out.',
    )
  })

  it('inserts a token through the ref', async () => {
    const { ref, onChange } = await mount({ value: 'Hi ', protectedRanges: [] })
    act(() => ref.current?.insertToken('first_name'))
    expect(onChange).toHaveBeenLastCalledWith(
      expect.stringContaining('{first_name}'),
    )
  })

  it('marks the textbox read-only and invalid when asked', async () => {
    const { box } = await mount({ readOnly: true, 'aria-invalid': true })
    await waitFor(() => expect(box).toHaveAttribute('aria-readonly', 'true'))
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(box).toHaveAttribute('contenteditable', 'false')
  })

  // As a textarea's maxlength: nothing grows past it, a cut always lands.
  it('refuses an edit past maxLength and allows one that shortens', async () => {
    const { editor, onChange } = await mount({
      value: 'Hi there.',
      tokens: [],
      protectedRanges: [],
      maxLength: 12,
    })
    act(() => {
      editor.commands.insertContentAt(positionOf(editor, '.'), ' you all')
    })
    expect(editor.getText()).toBe('Hi there.')
    expect(onChange).not.toHaveBeenCalled()

    act(() => {
      editor.commands.insertContentAt(positionOf(editor, '.'), ' yo')
    })
    expect(editor.getText()).toBe('Hi there yo.')
    act(() => {
      editor.commands.insertContentAt(positionOf(editor, '.'), '!')
    })
    expect(editor.getText()).toBe('Hi there yo.')
    act(() => {
      const at = positionOf(editor, ' yo')
      editor.view.dispatch(editor.state.tr.delete(at, at + 3))
    })
    expect(editor.getText()).toBe('Hi there.')
  })
})
