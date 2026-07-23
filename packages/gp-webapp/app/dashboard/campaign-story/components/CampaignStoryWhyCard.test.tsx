import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import CampaignStoryWhyCard from './CampaignStoryWhyCard'

vi.mock('app/shared/utils/RichEditor', async () => ({
  default: (await import('helpers/test-utils/RichEditorMock')).RichEditorMock,
}))

const { saveAboutFields } = vi.hoisted(() => ({ saveAboutFields: vi.fn() }))
vi.mock('app/dashboard/website/util/website.util', () => ({
  USER_WEBSITE_QUERY_KEY: ['user-website'],
  saveAboutFields,
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

beforeEach(() => {
  vi.clearAllMocks()
  saveAboutFields.mockResolvedValue(true)
})

describe('CampaignStoryWhyCard', () => {
  it('renders the shared why prompt and the bio editor', async () => {
    render(<CampaignStoryWhyCard initialBio="" />)

    expect(screen.getByText('Your why')).toBeInTheDocument()
    expect(
      screen.getByText(/the moment, the people, the breaking point/i),
    ).toBeInTheDocument()
    expect(await screen.findByTestId('rich-editor')).toBeInTheDocument()
  })

  it('persists the bio to the website when Save is clicked', async () => {
    const user = userEvent.setup()
    render(<CampaignStoryWhyCard initialBio="" />)

    fireEvent.change(await screen.findByTestId('rich-editor'), {
      target: { value: 'Because of the schools' },
    })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(saveAboutFields).toHaveBeenCalledWith({
        bio: 'Because of the schools',
      }),
    )
  })

  it('reports its answered-state as the candidate types', async () => {
    const onAnsweredChange = vi.fn()
    render(
      <CampaignStoryWhyCard
        initialBio=""
        onAnsweredChange={onAnsweredChange}
      />,
    )

    fireEvent.change(await screen.findByTestId('rich-editor'), {
      target: { value: 'a why' },
    })

    expect(onAnsweredChange).toHaveBeenLastCalledWith(true)
  })

  it('improves the why in place and persists it, exposing Undo', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/campaigns/mine/story/rewrite', async ({ body }) => {
      expect(body).toEqual({ field: 'why', text: 'rough why' })
      return { status: 200, data: { rewrite: 'A sharper why.' } }
    })

    render(<CampaignStoryWhyCard initialBio="rough why" />)
    await user.click(screen.getByRole('button', { name: /Improve with AI/ }))

    // No suggestion panel or "Use this" — the improvement is applied + saved.
    await waitFor(() =>
      expect(saveAboutFields).toHaveBeenCalledWith({ bio: 'A sharper why.' }),
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.CampaignStory.RewriteAccepted,
      { field: 'why' },
    )
    expect(
      screen.queryByRole('button', { name: /Use this/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Undo/ })).toBeInTheDocument()
  })

  it('"Undo" restores the pre-improvement why and re-saves it', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/campaigns/mine/story/rewrite', async () => ({
      status: 200,
      data: { rewrite: 'A sharper why.' },
    }))

    render(<CampaignStoryWhyCard initialBio="rough why" />)
    await user.click(screen.getByRole('button', { name: /Improve with AI/ }))
    await waitFor(() =>
      expect(saveAboutFields).toHaveBeenCalledWith({ bio: 'A sharper why.' }),
    )

    await user.click(screen.getByRole('button', { name: /Undo/ }))

    await waitFor(() =>
      expect(saveAboutFields).toHaveBeenCalledWith({ bio: 'rough why' }),
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.CampaignStory.RewriteDiscarded,
      { field: 'why' },
    )
    expect(
      screen.queryByRole('button', { name: /Undo/ }),
    ).not.toBeInTheDocument()
  })

  it('disables the rewrite button until there is text', async () => {
    render(<CampaignStoryWhyCard initialBio="" />)

    const button = screen.getByRole('button', { name: /Improve with AI/ })
    expect(button).toBeDisabled()

    fireEvent.change(await screen.findByTestId('rich-editor'), {
      target: { value: 'a rough why' },
    })
    expect(button).toBeEnabled()
  })
})
