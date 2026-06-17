import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import CampaignStoryCard, {
  type CampaignStorySection,
} from './CampaignStoryCard'

const section: CampaignStorySection = {
  id: 'why',
  title: 'Your why',
  description: 'The moment, the people, the breaking point.',
  placeholder: 'Tap to write your why',
}

const emptyStory = { why: null, background: null, issues: null }

describe('CampaignStoryCard', () => {
  it('shows the not-answered hint when empty', () => {
    render(<CampaignStoryCard section={section} initialValue={null} />)
    expect(
      screen.getByText(
        'Not answered yet. Even two sentences here unlocks a lot.',
      ),
    ).toBeInTheDocument()
  })

  it('shows the say-more hint for a short answer', () => {
    render(<CampaignStoryCard section={section} initialValue="Short start." />)
    expect(screen.getByText(/Worth saying more/)).toBeInTheDocument()
  })

  it('shows positive reinforcement once the answer is substantial', () => {
    render(
      <CampaignStoryCard section={section} initialValue={'x'.repeat(120)} />,
    )
    expect(screen.getByText(/That's great/)).toBeInTheDocument()
  })

  it('autosaves the field on blur', async () => {
    const user = userEvent.setup()
    let putBody: { why?: string; background?: string; issues?: string } | null =
      null
    api.mock('PUT /v1/campaigns/mine/story', async ({ body }) => {
      putBody = body
      return { status: 200, data: emptyStory }
    })

    render(<CampaignStoryCard section={section} initialValue={null} />)
    await user.type(
      screen.getByPlaceholderText('Tap to write your why'),
      'Because of the schools',
    )
    await user.tab()

    await waitFor(() => {
      expect(putBody).toEqual({ why: 'Because of the schools' })
    })
  })

  it('flushes a trailing edit made while a save is in flight', async () => {
    const user = userEvent.setup()
    const bodies: Array<{ why?: string }> = []
    let releaseFirst: () => void = () => undefined
    const firstSave = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let isFirst = true
    api.mock('PUT /v1/campaigns/mine/story', async ({ body }) => {
      bodies.push(body)
      if (isFirst) {
        isFirst = false
        await firstSave
      }
      return { status: 200, data: emptyStory }
    })

    render(<CampaignStoryCard section={section} initialValue={null} />)
    const textarea = screen.getByPlaceholderText('Tap to write your why')

    await user.type(textarea, 'first')
    await user.tab() // starts the (gated) first save

    await user.click(textarea)
    await user.type(textarea, ' second')
    await user.tab() // in flight, so this blur is a no-op...

    releaseFirst() // ...the in-flight save's loop flushes the newer text

    await waitFor(() => {
      expect(bodies.at(-1)).toEqual({ why: 'first second' })
    })
  })

  it('does not save on blur when the value is unchanged', async () => {
    const user = userEvent.setup()
    let called = false
    api.mock('PUT /v1/campaigns/mine/story', async () => {
      called = true
      return { status: 200, data: emptyStory }
    })

    render(<CampaignStoryCard section={section} initialValue="unchanged" />)
    await user.click(screen.getByPlaceholderText('Tap to write your why'))
    await user.tab()

    expect(called).toBe(false)
  })
})
