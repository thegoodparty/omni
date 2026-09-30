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
})
