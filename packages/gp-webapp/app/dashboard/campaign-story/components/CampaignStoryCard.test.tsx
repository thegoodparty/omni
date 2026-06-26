import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import CampaignStoryCard, {
  type CampaignStorySection,
} from './CampaignStoryCard'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

beforeEach(() => {
  vi.mocked(trackEvent).mockClear()
})

const section: CampaignStorySection = {
  id: 'why',
  title: 'Your why',
  description: 'The moment, the people, the breaking point.',
  placeholder: 'Tap to write your why',
  example: 'A short example why.',
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

  it('surfaces an error with a working retry when the save fails', async () => {
    const user = userEvent.setup()
    let shouldFail = true
    api.mock('PUT /v1/campaigns/mine/story', async () => {
      if (shouldFail) return { status: 500, data: emptyStory }
      return { status: 200, data: emptyStory }
    })

    render(<CampaignStoryCard section={section} initialValue={null} />)
    await user.type(
      screen.getByPlaceholderText('Tap to write your why'),
      'attempt',
    )
    await user.tab()

    const retry = await screen.findByRole('button', { name: 'Retry' })
    expect(screen.getByText(/Couldn't save/)).toBeInTheDocument()

    shouldFail = false
    await user.click(retry)

    await waitFor(() => {
      expect(screen.queryByText(/Couldn't save/)).not.toBeInTheDocument()
    })
  })

  it('clears the error when the text is reverted to the saved value', async () => {
    const user = userEvent.setup()
    api.mock('PUT /v1/campaigns/mine/story', async () => ({
      status: 500,
      data: emptyStory,
    }))

    render(<CampaignStoryCard section={section} initialValue={null} />)
    const textarea = screen.getByPlaceholderText('Tap to write your why')
    await user.type(textarea, 'x')
    await user.tab()
    expect(await screen.findByText(/Couldn't save/)).toBeInTheDocument()

    await user.clear(textarea)
    await user.tab()

    await waitFor(() => {
      expect(screen.queryByText(/Couldn't save/)).not.toBeInTheDocument()
    })
  })

  it('flushes a newer edit made while a failed save was in flight', async () => {
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
        return { status: 500, data: emptyStory }
      }
      return { status: 200, data: emptyStory }
    })

    render(<CampaignStoryCard section={section} initialValue={null} />)
    const textarea = screen.getByPlaceholderText('Tap to write your why')

    await user.type(textarea, 'A')
    await user.tab() // first save, gated, will fail

    await user.click(textarea)
    await user.type(textarea, ' B')
    await user.tab() // in flight, no-op

    releaseFirst() // first save fails; the newer 'A B' is auto-flushed once

    await waitFor(() => {
      expect(bodies.at(-1)).toEqual({ why: 'A B' })
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

  describe('Save button', () => {
    it('is disabled until the text changes, then saves on click', async () => {
      const user = userEvent.setup()
      let putBody: { why?: string } | null = null
      api.mock('PUT /v1/campaigns/mine/story', async ({ body }) => {
        putBody = body
        return { status: 200, data: emptyStory }
      })

      render(<CampaignStoryCard section={section} initialValue={null} />)
      const save = screen.getByRole('button', { name: 'Save' })
      expect(save).toBeDisabled()

      await user.type(
        screen.getByPlaceholderText('Tap to write your why'),
        'Because of the schools',
      )
      expect(save).toBeEnabled()

      await user.click(save)

      await waitFor(() => {
        expect(putBody).toEqual({ why: 'Because of the schools' })
      })
    })

    it('shows "Saving…" and stays disabled while the save is in flight', async () => {
      const user = userEvent.setup()
      let releaseSave: () => void = () => undefined
      const inFlight = new Promise<void>((resolve) => {
        releaseSave = resolve
      })
      api.mock('PUT /v1/campaigns/mine/story', async () => {
        await inFlight
        return { status: 200, data: emptyStory }
      })

      render(<CampaignStoryCard section={section} initialValue={null} />)
      await user.type(
        screen.getByPlaceholderText('Tap to write your why'),
        'Because of the schools',
      )
      await user.click(screen.getByRole('button', { name: 'Save' }))

      const saving = await screen.findByRole('button', { name: 'Saving…' })
      expect(saving).toBeDisabled()

      releaseSave()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled()
      })
    })

    it('shows "Saved" and re-disables once the current text is persisted', async () => {
      const user = userEvent.setup()
      api.mock('PUT /v1/campaigns/mine/story', async () => ({
        status: 200,
        data: emptyStory,
      }))

      render(<CampaignStoryCard section={section} initialValue="saved why" />)
      const textarea = screen.getByPlaceholderText('Tap to write your why')
      await user.type(textarea, ' more')
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled()
      })
    })
  })

  describe('Save button stays visible during a rewrite', () => {
    it('keeps the Save button rendered while a suggestion is showing', async () => {
      const user = userEvent.setup()
      api.mock('POST /v1/campaigns/mine/story/rewrite', async () => ({
        status: 200,
        data: { rewrite: 'A sharper why.' },
      }))

      render(<CampaignStoryCard section={section} initialValue="rough why" />)
      await user.click(screen.getByRole('button', { name: /Help me rewrite/ }))
      await screen.findByText('A sharper why.')

      expect(screen.getByRole('button', { name: /^Save/ })).toBeInTheDocument()
    })
  })

  describe("Here's an example", () => {
    it('reveals the example text when expanded', async () => {
      const user = userEvent.setup()
      render(<CampaignStoryCard section={section} initialValue={null} />)

      await user.click(
        screen.getByRole('button', { name: /Here's an example/ }),
      )
      expect(await screen.findByText('A short example why.')).toBeVisible()
    })
  })

  describe('Help me rewrite', () => {
    it('disables the rewrite button until there is text', async () => {
      const user = userEvent.setup()
      render(<CampaignStoryCard section={section} initialValue={null} />)

      const button = screen.getByRole('button', { name: /Help me rewrite/ })
      expect(button).toBeDisabled()

      await user.type(
        screen.getByPlaceholderText('Tap to write your why'),
        'a rough why',
      )
      expect(button).toBeEnabled()
    })

    it('requests a rewrite and shows the suggestion with three actions', async () => {
      const user = userEvent.setup()
      let rewriteBody: { field?: string; text?: string } | null = null
      api.mock('POST /v1/campaigns/mine/story/rewrite', async ({ body }) => {
        rewriteBody = body
        return { status: 200, data: { rewrite: 'A sharper why.' } }
      })

      render(<CampaignStoryCard section={section} initialValue="rough why" />)
      await user.click(screen.getByRole('button', { name: /Help me rewrite/ }))

      expect(await screen.findByText('A sharper why.')).toBeInTheDocument()
      expect(rewriteBody).toEqual({ field: 'why', text: 'rough why' })
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.CampaignStory.RewriteRequested,
        { field: 'why', source: 'initial' },
      )
      expect(
        screen.getByRole('button', { name: /Discard/ }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /Try again/ }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /Use this/ }),
      ).toBeInTheDocument()
    })

    it('"Use this" replaces the text and saves immediately', async () => {
      const user = userEvent.setup()
      let putBody: { why?: string } | null = null
      api.mock('POST /v1/campaigns/mine/story/rewrite', async () => ({
        status: 200,
        data: { rewrite: 'A sharper why.' },
      }))
      api.mock('PUT /v1/campaigns/mine/story', async ({ body }) => {
        putBody = body
        return { status: 200, data: emptyStory }
      })

      render(<CampaignStoryCard section={section} initialValue="rough why" />)
      await user.click(screen.getByRole('button', { name: /Help me rewrite/ }))
      await screen.findByText('A sharper why.')
      await user.click(screen.getByRole('button', { name: /Use this/ }))

      await waitFor(() => {
        expect(putBody).toEqual({ why: 'A sharper why.' })
      })
      const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>(
        'Tap to write your why',
      )
      expect(textarea.value).toBe('A sharper why.')
      // The suggestion card is dismissed once accepted.
      expect(screen.queryByText('Suggested rewrite')).not.toBeInTheDocument()
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.CampaignStory.RewriteAccepted,
        { field: 'why' },
      )
    })

    it('"Discard" dismisses the suggestion without saving', async () => {
      const user = userEvent.setup()
      let putCalled = false
      api.mock('POST /v1/campaigns/mine/story/rewrite', async () => ({
        status: 200,
        data: { rewrite: 'A sharper why.' },
      }))
      api.mock('PUT /v1/campaigns/mine/story', async () => {
        putCalled = true
        return { status: 200, data: emptyStory }
      })

      render(<CampaignStoryCard section={section} initialValue="rough why" />)
      await user.click(screen.getByRole('button', { name: /Help me rewrite/ }))
      await screen.findByText('A sharper why.')
      await user.click(screen.getByRole('button', { name: /Discard/ }))

      expect(screen.queryByText('A sharper why.')).not.toBeInTheDocument()
      expect(putCalled).toBe(false)
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.CampaignStory.RewriteDiscarded,
        { field: 'why' },
      )
      expect(trackEvent).not.toHaveBeenCalledWith(
        EVENTS.CampaignStory.RewriteAccepted,
        expect.anything(),
      )
    })

    it('shows an error when the rewrite call fails', async () => {
      const user = userEvent.setup()
      api.mock('POST /v1/campaigns/mine/story/rewrite', async () => ({
        status: 500,
        data: { rewrite: '' },
      }))

      render(<CampaignStoryCard section={section} initialValue="rough why" />)
      await user.click(screen.getByRole('button', { name: /Help me rewrite/ }))

      expect(
        await screen.findByText(/Couldn't generate a rewrite/),
      ).toBeInTheDocument()
    })

    it('shows the AI-limit notice and disables rewriting on a 403', async () => {
      const user = userEvent.setup()
      api.mock('POST /v1/campaigns/mine/story/rewrite', async () => ({
        status: 403,
        data: { rewrite: '' },
      }))

      render(<CampaignStoryCard section={section} initialValue="rough why" />)
      await user.click(screen.getByRole('button', { name: /Help me rewrite/ }))

      expect(
        await screen.findByText(/reached your AI rewrite limit/i),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /Help me rewrite/ }),
      ).toBeDisabled()
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.CampaignStory.RewriteLimitReached,
        { field: 'why' },
      )
    })
  })
})
