import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import StoryIntakeCard from './StoryIntakeCard'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

beforeEach(() => {
  vi.mocked(trackEvent).mockClear()
})

// Controlled wrapper so improve/undo (which drive the parent's onChange) are
// reflected back into the field — the card itself holds no value state.
const Harness = ({ initial = '' }: { initial?: string }): React.JSX.Element => {
  const [value, setValue] = useState(initial)
  return (
    <StoryIntakeCard
      question="Why are you running?"
      examplePlaceholder="e.g. a reason"
      value={value}
      onChange={setValue}
      rewriteField="why"
      analyticsLabel="test_why"
    />
  )
}

describe('StoryIntakeCard', () => {
  it('shows the question, the example placeholder, and a live char counter', () => {
    render(<Harness initial="hello" />)

    expect(
      screen.getByRole('heading', { name: /why are you running/i }),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText('e.g. a reason')).toBeInTheDocument()
    expect(screen.getByText('5 chars')).toBeInTheDocument()
  })

  it('disables Improve with AI until there is text', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const improve = screen.getByRole('button', { name: /Improve with AI/ })
    expect(improve).toBeDisabled()

    await user.type(screen.getByPlaceholderText('e.g. a reason'), 'a why')
    expect(improve).toBeEnabled()
  })

  it('drops the improved text into the field and offers Undo that restores the original', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/campaigns/mine/story/rewrite', async () => ({
      status: 200,
      data: { rewrite: 'A sharper why.' },
    }))

    render(<Harness initial="rough why" />)
    const field =
      screen.getByPlaceholderText<HTMLTextAreaElement>('e.g. a reason')

    await user.click(screen.getByRole('button', { name: /Improve with AI/ }))

    await waitFor(() => expect(field.value).toBe('A sharper why.'))
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.CampaignStory.RewriteAccepted,
      { field: 'why' },
    )
    const undo = screen.getByRole('button', { name: /Undo/ })

    await user.click(undo)

    await waitFor(() => expect(field.value).toBe('rough why'))
    expect(
      screen.queryByRole('button', { name: /Undo/ }),
    ).not.toBeInTheDocument()
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.CampaignStory.RewriteDiscarded,
      { field: 'why' },
    )
  })
})
