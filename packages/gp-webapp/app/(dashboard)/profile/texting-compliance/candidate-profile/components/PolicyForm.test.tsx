import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { MIN_POLICY_FOCUS_LENGTH } from '../candidateProfile.utils'
import PolicyForm from './PolicyForm'

vi.mock('app/shared/utils/RichEditor', async () => ({
  default: (await import('helpers/test-utils/RichEditorMock')).RichEditorMock,
}))

const typeFocus = (length: number) => {
  fireEvent.change(screen.getByTestId('rich-editor'), {
    target: { value: 'x'.repeat(length) },
  })
}

describe('PolicyForm — validation messaging', () => {
  it('keeps the Save button enabled even when the form is empty', () => {
    render(
      <PolicyForm showDelete={false} onSave={vi.fn()} onDelete={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled()
  })

  it('shows the combined add-fields message and flags both fields when empty', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<PolicyForm showDelete={false} onSave={onSave} onDelete={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(onSave).not.toHaveBeenCalled()
    expect(
      screen.getByText('Please add a Policy title and Policy focus'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Policy title')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByTestId('rich-editor')).toHaveAttribute(
      'data-error',
      'true',
    )
  })

  it('reports the focus length requirement when the title is set but focus is too short', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<PolicyForm showDelete={false} onSave={onSave} onDelete={vi.fn()} />)

    await user.type(screen.getByLabelText('Policy title'), 'Education')
    typeFocus(MIN_POLICY_FOCUS_LENGTH - 1)
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(onSave).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        `Policy focus requires ${MIN_POLICY_FOCUS_LENGTH} characters`,
      ),
    ).toBeInTheDocument()
    // Title is valid now, so only the focus field is flagged.
    expect(screen.getByLabelText('Policy title')).toHaveAttribute(
      'aria-invalid',
      'false',
    )
    expect(screen.getByTestId('rich-editor')).toHaveAttribute(
      'data-error',
      'true',
    )
  })

  it('saves the trimmed title and description once the form is valid', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<PolicyForm showDelete={false} onSave={onSave} onDelete={vi.fn()} />)

    await user.type(screen.getByLabelText('Policy title'), '  Education  ')
    typeFocus(MIN_POLICY_FOCUS_LENGTH)
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith({
      title: 'Education',
      description: 'x'.repeat(MIN_POLICY_FOCUS_LENGTH),
    })
    expect(screen.queryByText(/Please add a Policy/)).not.toBeInTheDocument()
  })

  it('saves an existing policy without re-typing, before the editor reports a length', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const existing = {
      title: 'Education',
      description: 'x'.repeat(MIN_POLICY_FOCUS_LENGTH),
    }
    render(
      <PolicyForm
        initial={existing}
        showDelete
        onSave={onSave}
        onDelete={vi.fn()}
      />,
    )

    // No typing: the description length must be seeded from `initial` so a
    // valid existing policy isn't falsely blocked before the dynamic editor
    // fires its first onTextLengthChange.
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(existing)
    expect(screen.queryByText(/Please add a Policy/)).not.toBeInTheDocument()
  })
})

describe('PolicyForm — Help me rewrite', () => {
  // Longer than MIN_POLICY_FOCUS_LENGTH so Save isn't blocked after accepting,
  // and free of HTML-special chars so the <p> wrapping is the only transform.
  const SUGGESTION =
    'A polished, first-person policy focus that runs comfortably past the one hundred character minimum the field requires.'

  it('disables "Help me rewrite" until the focus has content', () => {
    render(
      <PolicyForm showDelete={false} onSave={vi.fn()} onDelete={vi.fn()} />,
    )
    expect(
      screen.getByRole('button', { name: /help me rewrite/i }),
    ).toBeDisabled()
  })

  it('applies the rewrite as wrapped HTML and Save persists it', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    api.mock('POST /v1/campaigns/mine/story/rewrite', {
      status: 200,
      data: { rewrite: SUGGESTION },
    })
    render(<PolicyForm showDelete={false} onSave={onSave} onDelete={vi.fn()} />)

    await user.type(screen.getByLabelText('Policy title'), 'Roads')
    typeFocus(40)
    await user.click(screen.getByRole('button', { name: /help me rewrite/i }))
    await user.click(await screen.findByRole('button', { name: /use this/i }))

    // The suggestion replaced the editor content as <p>-wrapped HTML, and the
    // suggestion card is dismissed.
    expect(screen.getByTestId('rich-editor')).toHaveValue(
      `<p>${SUGGESTION}</p>`,
    )
    expect(
      screen.queryByRole('button', { name: /use this/i }),
    ).not.toBeInTheDocument()

    // Save persists exactly that HTML — description must be Quill HTML, not
    // raw text.
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledWith({
      title: 'Roads',
      description: `<p>${SUGGESTION}</p>`,
    })
  })

  it('shows the AI-limit notice and permanently disables rewriting on a 403', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/campaigns/mine/story/rewrite', {
      status: 403,
      data: { rewrite: '' },
    })
    render(
      <PolicyForm showDelete={false} onSave={vi.fn()} onDelete={vi.fn()} />,
    )

    typeFocus(40)
    await user.click(screen.getByRole('button', { name: /help me rewrite/i }))

    expect(
      await screen.findByText(/reached your AI rewrite limit/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /help me rewrite/i }),
    ).toBeDisabled()
  })
})
