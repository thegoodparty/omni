import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { WebsiteIssue } from 'helpers/types'
import { api } from 'helpers/test-utils/api-mocking'
import { USER_WEBSITE_QUERY_KEY } from 'app/(dashboard)/website/util/website.util'
import { CAMPAIGN_STORY_QUERY_KEY } from '../useCampaignStory'
import { StoryEditorForm } from './CampaignStoryPage'

const { mockSaveAboutFields, mockErrorSnackbar } = vi.hoisted(() => ({
  mockSaveAboutFields: vi.fn(),
  mockErrorSnackbar: vi.fn(),
}))

vi.mock('app/(dashboard)/website/util/website.util', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('app/(dashboard)/website/util/website.util')
    >()
  return { ...actual, saveAboutFields: mockSaveAboutFields }
})

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    errorSnackbar: mockErrorSnackbar,
    successSnackbar: vi.fn(),
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockSaveAboutFields.mockResolvedValue(true)
})

const renderForm = (
  props: {
    initialBio?: string
    initialBackground?: string
    initialIssues?: WebsiteIssue[]
  } = {},
) => {
  const queryClient = new QueryClient()
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
  render(
    <QueryClientProvider client={queryClient}>
      <StoryEditorForm
        initialBio={props.initialBio ?? ''}
        initialBackground={props.initialBackground ?? ''}
        initialIssues={props.initialIssues ?? []}
      />
    </QueryClientProvider>,
  )
  return { invalidateSpy }
}

const whyField = (): HTMLTextAreaElement =>
  screen.getByPlaceholderText<HTMLTextAreaElement>(/bus route to my mom/i)
const backgroundField = (): HTMLTextAreaElement =>
  screen.getByPlaceholderText<HTMLTextAreaElement>(
    /graduated from Lincoln High/i,
  )
const status = (): HTMLElement => screen.getByRole('status')
// Autosave waits a second after typing stops, so give it room.
const AUTOSAVE_WAIT = { timeout: 3000 }

const startOver = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /^start over$/i }))
  // It asks first, since autosave makes clearing stick.
  await user.click(
    await screen.findByRole('button', { name: /^start over$/i, hidden: false }),
  )
}

describe('StoryEditorForm (the "Your story" editor)', () => {
  it('has no Save button: the why saves itself after a pause', async () => {
    const user = userEvent.setup()
    const { invalidateSpy } = renderForm()

    expect(
      screen.queryByRole('button', { name: /^save$/i }),
    ).not.toBeInTheDocument()

    await user.type(whyField(), 'Because of the schools')
    expect(status()).toHaveTextContent('Saving…')

    await waitFor(
      () =>
        expect(mockSaveAboutFields).toHaveBeenCalledWith({
          bio: 'Because of the schools',
        }),
      AUTOSAVE_WAIT,
    )
    expect(mockSaveAboutFields).toHaveBeenCalledTimes(1)
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: USER_WEBSITE_QUERY_KEY,
    })
    await waitFor(() => expect(status()).toHaveTextContent('Saved'))
  })

  it('saves the background through the story endpoint', async () => {
    const user = userEvent.setup()
    let putBody: { background?: string } | null = null
    api.mock('PUT /v1/campaigns/mine/story', async ({ body }) => {
      putBody = body as { background?: string }
      return { status: 200, data: { background: 'saved' } }
    })
    const { invalidateSpy } = renderForm()

    await user.type(backgroundField(), 'I grew up here')

    await waitFor(
      () => expect(putBody).toEqual({ background: 'I grew up here' }),
      AUTOSAVE_WAIT,
    )
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: CAMPAIGN_STORY_QUERY_KEY,
    })
  })

  it('saves edited policy issues', async () => {
    const user = userEvent.setup()
    const { invalidateSpy } = renderForm({
      initialIssues: [{ title: 'Roads', description: 'Fix them' }],
    })

    const description =
      screen.getByPlaceholderText<HTMLTextAreaElement>(/northside bus route/i)
    await user.clear(description)
    await user.type(description, 'Fix them now')

    await waitFor(
      () =>
        expect(mockSaveAboutFields).toHaveBeenCalledWith({
          issues: [{ title: 'Roads', description: 'Fix them now' }],
        }),
      AUTOSAVE_WAIT,
    )
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: USER_WEBSITE_QUERY_KEY,
    })
  })

  it('says when a save failed, and does not retry until the answer changes', async () => {
    const user = userEvent.setup()
    mockSaveAboutFields.mockResolvedValue(false)
    renderForm()

    await user.type(whyField(), 'Because of the schools')

    await waitFor(
      () => expect(status()).toHaveTextContent('Not saved'),
      AUTOSAVE_WAIT,
    )
    expect(mockErrorSnackbar).toHaveBeenCalledTimes(1)
    // A second autosave window passes with no retry.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(mockSaveAboutFields).toHaveBeenCalledTimes(1)

    mockSaveAboutFields.mockResolvedValue(true)
    await user.type(whyField(), '!')
    await waitFor(
      () =>
        expect(mockSaveAboutFields).toHaveBeenLastCalledWith({
          bio: 'Because of the schools!',
        }),
      AUTOSAVE_WAIT,
    )
  })

  it('saves what is still waiting before going back', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(whyField(), 'Because of the schools')
    // Straight to Back, before the autosave pause runs out.
    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(mockSaveAboutFields).toHaveBeenCalledWith({
      bio: 'Because of the schools',
    })
  })

  it('hides "Start over" until something is entered', async () => {
    const user = userEvent.setup()
    renderForm()

    expect(
      screen.queryByRole('button', { name: /start over/i }),
    ).not.toBeInTheDocument()
    await user.type(whyField(), 'Because of the schools')
    expect(
      await screen.findByRole('button', { name: /start over/i }),
    ).toBeInTheDocument()
  })

  it('"Start over" asks first, and keeping the story changes nothing', async () => {
    const user = userEvent.setup()
    renderForm({ initialBio: 'my saved why' })

    await user.click(screen.getByRole('button', { name: /^start over$/i }))
    await user.click(
      await screen.findByRole('button', { name: 'Keep my story' }),
    )

    expect(whyField().value).toBe('my saved why')
    expect(mockSaveAboutFields).not.toHaveBeenCalled()
  })

  it('"Start over" clears every answer and saves the empty story', async () => {
    const user = userEvent.setup()
    let putBody: { background?: string } | null = null
    api.mock('PUT /v1/campaigns/mine/story', async ({ body }) => {
      putBody = body as { background?: string }
      return { status: 200, data: { background: '' } }
    })
    renderForm({
      initialBio: 'my saved why',
      initialBackground: 'my saved background',
      initialIssues: [{ title: 'Roads', description: 'Fix them' }],
    })

    await startOver(user)

    await waitFor(() => expect(whyField().value).toBe(''))
    expect(backgroundField().value).toBe('')
    expect(
      screen.queryByPlaceholderText(/northside bus route/i),
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockSaveAboutFields).toHaveBeenCalledWith({ bio: '' })
      expect(mockSaveAboutFields).toHaveBeenCalledWith({ issues: [] })
      expect(putBody).toEqual({ background: '' })
    }, AUTOSAVE_WAIT)
  })

  it('"Start over" clears a card\'s pending Undo (remounts the cards)', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/campaigns/mine/story/rewrite', async () => ({
      status: 200,
      data: { rewrite: 'An AI-sharpened why.' },
    }))
    renderForm({ initialBio: 'my saved why' })

    await user.click(
      screen.getAllByRole('button', { name: /Improve with AI/ })[0]!,
    )
    await screen.findByRole('button', { name: /Undo/ })

    await startOver(user)

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /Undo/ }),
      ).not.toBeInTheDocument(),
    )
    expect(whyField().value).toBe('')
  })

  it('Undo after Improve puts the saved why back without saving', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/campaigns/mine/story/rewrite', async () => ({
      status: 200,
      data: { rewrite: 'An AI-sharpened why.' },
    }))
    renderForm({ initialBio: 'my saved why' })

    const field = whyField()
    await user.click(
      screen.getAllByRole('button', { name: /Improve with AI/ })[0]!,
    )
    await waitFor(() => expect(field.value).toBe('An AI-sharpened why.'))
    // Undone inside the pause, so the rewrite never reaches the server.
    await user.click(screen.getByRole('button', { name: /Undo/ }))
    await waitFor(() => expect(field.value).toBe('my saved why'))

    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(mockSaveAboutFields).not.toHaveBeenCalled()
  })
})
