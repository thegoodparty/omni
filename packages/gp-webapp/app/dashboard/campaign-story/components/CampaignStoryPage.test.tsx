import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { WebsiteIssue } from 'helpers/types'
import { api } from 'helpers/test-utils/api-mocking'
import { USER_WEBSITE_QUERY_KEY } from 'app/dashboard/website/util/website.util'
import { CAMPAIGN_STORY_QUERY_KEY } from '../useCampaignStory'
import { StoryEditorForm } from './CampaignStoryPage'

const { mockSaveAboutFields, mockErrorSnackbar } = vi.hoisted(() => ({
  mockSaveAboutFields: vi.fn(),
  mockErrorSnackbar: vi.fn(),
}))

vi.mock('app/dashboard/website/util/website.util', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('app/dashboard/website/util/website.util')
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
const enabledSaveButtons = (): HTMLElement[] =>
  screen
    .getAllByRole('button', { name: /^save$/i })
    .filter((b) => !(b as HTMLButtonElement).disabled)

describe('StoryEditorForm (the "Your story" dashboard editor)', () => {
  it('keeps every Save disabled until its field changes', async () => {
    const user = userEvent.setup()
    renderForm()

    expect(enabledSaveButtons()).toHaveLength(0)

    await user.type(whyField(), 'Because of the schools')

    // Only the edited (why) card's Save unlocks.
    expect(enabledSaveButtons()).toHaveLength(1)
  })

  it('persists the why on Save, invalidates the website cache, and marks it Saved', async () => {
    const user = userEvent.setup()
    const { invalidateSpy } = renderForm()

    await user.type(whyField(), 'Because of the schools')
    await user.click(enabledSaveButtons()[0]!)

    await waitFor(() =>
      expect(mockSaveAboutFields).toHaveBeenCalledWith({
        bio: 'Because of the schools',
      }),
    )
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: USER_WEBSITE_QUERY_KEY,
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Saved' })).toBeInTheDocument(),
    )
  })

  it('persists the background via the story endpoint and invalidates the story cache', async () => {
    const user = userEvent.setup()
    let putBody: { background?: string } | null = null
    api.mock('PUT /v1/campaigns/mine/story', async ({ body }) => {
      putBody = body as { background?: string }
      return { status: 200, data: { background: 'saved' } }
    })
    const { invalidateSpy } = renderForm()

    await user.type(backgroundField(), 'I grew up here')
    await user.click(enabledSaveButtons()[0]!)

    await waitFor(() =>
      expect(putBody).toEqual({ background: 'I grew up here' }),
    )
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: CAMPAIGN_STORY_QUERY_KEY,
    })
  })

  it('shows an error snackbar and leaves the field unsaved when the save fails', async () => {
    const user = userEvent.setup()
    mockSaveAboutFields.mockResolvedValue(false)
    renderForm()

    await user.type(whyField(), 'Because of the schools')
    await user.click(enabledSaveButtons()[0]!)

    await waitFor(() => expect(mockErrorSnackbar).toHaveBeenCalled())
    // Still dirty: no "Saved", the Save is still enabled.
    expect(
      screen.queryByRole('button', { name: 'Saved' }),
    ).not.toBeInTheDocument()
    expect(enabledSaveButtons()).toHaveLength(1)
  })

  it('hides the ready banner until all three fields have saved content', () => {
    renderForm()
    expect(
      screen.queryByText(/your campaign story is ready/i),
    ).not.toBeInTheDocument()
  })

  it('shows the ready banner for a fully-answered story', () => {
    renderForm({
      initialBio: '<p>My why</p>',
      initialBackground: 'My background',
      initialIssues: [{ title: 'Roads', description: 'Fix them' }],
    })
    expect(
      screen.getByText(/your campaign story is ready/i),
    ).toBeInTheDocument()
  })

  it('Improve marks the why dirty (not auto-saved) and Undo restores it clean', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/campaigns/mine/story/rewrite', async () => ({
      status: 200,
      data: { rewrite: 'An AI-sharpened why.' },
    }))
    // Seed the why as already-saved so "clean" is observable before + after.
    renderForm({ initialBio: 'my saved why' })

    const field = whyField()
    expect(field.value).toBe('my saved why')
    expect(enabledSaveButtons()).toHaveLength(0)

    // Improve rewrites in place; on the dashboard it's an edit like any other —
    // the field goes dirty and Save unlocks (it must NOT auto-save, or clear the
    // dirty flag via setSavedWhy).
    await user.click(
      screen.getAllByRole('button', { name: /Improve with AI/ })[0]!,
    )
    await waitFor(() => expect(field.value).toBe('An AI-sharpened why.'))
    expect(enabledSaveButtons()).toHaveLength(1)

    // Undo restores the pre-improvement (saved) text → clean again.
    await user.click(screen.getByRole('button', { name: /Undo/ }))
    await waitFor(() => expect(field.value).toBe('my saved why'))
    expect(enabledSaveButtons()).toHaveLength(0)

    // Neither Improve nor Undo persists on their own — Save is the persist path.
    expect(mockSaveAboutFields).not.toHaveBeenCalled()
  })

  it('saves edited policy issues via saveAboutFields', async () => {
    const user = userEvent.setup()
    const { invalidateSpy } = renderForm({
      initialIssues: [{ title: 'Roads', description: 'Fix them' }],
    })

    const description =
      screen.getByPlaceholderText<HTMLTextAreaElement>(/northside bus route/i)
    await user.clear(description)
    await user.type(description, 'Fix them now')

    // The issue row is the only dirty field, so its Save is the enabled one.
    await user.click(enabledSaveButtons()[0]!)

    await waitFor(() =>
      expect(mockSaveAboutFields).toHaveBeenCalledWith({
        issues: [{ title: 'Roads', description: 'Fix them now' }],
      }),
    )
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: USER_WEBSITE_QUERY_KEY,
    })
  })
})
