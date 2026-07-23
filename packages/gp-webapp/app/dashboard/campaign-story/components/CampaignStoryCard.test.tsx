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
  id: 'background',
  title: 'Your background',
  description: 'Childhood, career, community ties.',
  placeholder: 'Tap to write your background',
  example: 'A short example background.',
}

const emptyStory = { background: null }

describe('CampaignStoryCard', () => {
  it('autosaves the field on blur', async () => {
    const user = userEvent.setup()
    let putBody: { background?: string } | null = null
    api.mock('PUT /v1/campaigns/mine/story', async ({ body }) => {
      putBody = body
      return { status: 200, data: emptyStory }
    })

    render(<CampaignStoryCard section={section} initialValue={null} />)
    await user.type(
      screen.getByPlaceholderText('Tap to write your background'),
      'Grew up here',
    )
    await user.tab()

    await waitFor(() => {
      expect(putBody).toEqual({ background: 'Grew up here' })
    })
  })

  it('flushes a trailing edit made while a save is in flight', async () => {
    const user = userEvent.setup()
    const bodies: Array<{ background?: string }> = []
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
    const textarea = screen.getByPlaceholderText('Tap to write your background')

    await user.type(textarea, 'first')
    await user.tab() // starts the (gated) first save

    await user.click(textarea)
    await user.type(textarea, ' second')
    await user.tab() // in flight, so this blur is a no-op...

    releaseFirst() // ...the in-flight save's loop flushes the newer text

    await waitFor(() => {
      expect(bodies.at(-1)).toEqual({ background: 'first second' })
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
      screen.getByPlaceholderText('Tap to write your background'),
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
    const textarea = screen.getByPlaceholderText('Tap to write your background')
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
    const bodies: Array<{ background?: string }> = []
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
    const textarea = screen.getByPlaceholderText('Tap to write your background')

    await user.type(textarea, 'A')
    await user.tab() // first save, gated, will fail

    await user.click(textarea)
    await user.type(textarea, ' B')
    await user.tab() // in flight, no-op

    releaseFirst() // first save fails; the newer 'A B' is auto-flushed once

    await waitFor(() => {
      expect(bodies.at(-1)).toEqual({ background: 'A B' })
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
    await user.click(
      screen.getByPlaceholderText('Tap to write your background'),
    )
    await user.tab()

    expect(called).toBe(false)
  })

  describe('Save button', () => {
    it('appears once the text changes, then saves on click', async () => {
      const user = userEvent.setup()
      let putBody: { background?: string } | null = null
      api.mock('PUT /v1/campaigns/mine/story', async ({ body }) => {
        putBody = body
        return { status: 200, data: emptyStory }
      })

      render(<CampaignStoryCard section={section} initialValue={null} />)
      // No Save button until there's an unsaved edit.
      expect(
        screen.queryByRole('button', { name: 'Save' }),
      ).not.toBeInTheDocument()

      await user.type(
        screen.getByPlaceholderText('Tap to write your background'),
        'Grew up here',
      )
      const save = screen.getByRole('button', { name: 'Save' })
      expect(save).toBeEnabled()

      await user.click(save)

      await waitFor(() => {
        expect(putBody).toEqual({ background: 'Grew up here' })
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
        screen.getByPlaceholderText('Tap to write your background'),
        'Grew up here',
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

      render(
        <CampaignStoryCard section={section} initialValue="saved background" />,
      )
      const textarea = screen.getByPlaceholderText(
        'Tap to write your background',
      )
      await user.type(textarea, ' more')
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled()
      })
    })
  })

  describe("Here's an example", () => {
    it('reveals the example text when expanded', async () => {
      const user = userEvent.setup()
      render(<CampaignStoryCard section={section} initialValue={null} />)

      await user.click(
        screen.getByRole('button', { name: /Here's an example/ }),
      )
      expect(
        await screen.findByText('A short example background.'),
      ).toBeVisible()
    })
  })

  describe('Improve with AI', () => {
    it('disables the rewrite button until there is text', async () => {
      const user = userEvent.setup()
      render(<CampaignStoryCard section={section} initialValue={null} />)

      const button = screen.getByRole('button', { name: /Improve with AI/ })
      expect(button).toBeDisabled()

      await user.type(
        screen.getByPlaceholderText('Tap to write your background'),
        'a rough background',
      )
      expect(button).toBeEnabled()
    })

    it('drops the improved text straight into the field and saves it', async () => {
      const user = userEvent.setup()
      let rewriteBody: { field?: string; text?: string } | null = null
      let putBody: { background?: string } | null = null
      api.mock('POST /v1/campaigns/mine/story/rewrite', async ({ body }) => {
        rewriteBody = body
        return { status: 200, data: { rewrite: 'A sharper background.' } }
      })
      api.mock('PUT /v1/campaigns/mine/story', async ({ body }) => {
        putBody = body
        return { status: 200, data: emptyStory }
      })

      render(
        <CampaignStoryCard section={section} initialValue="rough background" />,
      )
      await user.click(screen.getByRole('button', { name: /Improve with AI/ }))

      const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>(
        'Tap to write your background',
      )
      await waitFor(() => {
        expect(textarea.value).toBe('A sharper background.')
      })
      await waitFor(() => {
        expect(putBody).toEqual({ background: 'A sharper background.' })
      })
      expect(rewriteBody).toEqual({
        field: 'background',
        text: 'rough background',
      })
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.CampaignStory.RewriteRequested,
        { field: 'background', source: 'initial' },
      )
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.CampaignStory.RewriteAccepted,
        { field: 'background' },
      )
      // No suggestion panel any more — just the field, plus an Undo affordance.
      expect(
        screen.queryByRole('button', { name: /Use this/ }),
      ).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Undo/ })).toBeInTheDocument()
    })

    it('"Undo" restores the pre-improvement text and re-saves it', async () => {
      const user = userEvent.setup()
      const putBodies: Array<{ background?: string }> = []
      api.mock('POST /v1/campaigns/mine/story/rewrite', async () => ({
        status: 200,
        data: { rewrite: 'A sharper background.' },
      }))
      api.mock('PUT /v1/campaigns/mine/story', async ({ body }) => {
        putBodies.push(body as { background?: string })
        return { status: 200, data: emptyStory }
      })

      render(
        <CampaignStoryCard section={section} initialValue="rough background" />,
      )
      await user.click(screen.getByRole('button', { name: /Improve with AI/ }))

      const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>(
        'Tap to write your background',
      )
      await waitFor(() => {
        expect(textarea.value).toBe('A sharper background.')
      })

      await user.click(screen.getByRole('button', { name: /Undo/ }))

      await waitFor(() => {
        expect(textarea.value).toBe('rough background')
      })
      await waitFor(() => {
        expect(putBodies).toContainEqual({ background: 'rough background' })
      })
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.CampaignStory.RewriteDiscarded,
        { field: 'background' },
      )
      // Undo is a one-shot: once used it's gone until the next improvement.
      expect(
        screen.queryByRole('button', { name: /Undo/ }),
      ).not.toBeInTheDocument()
    })

    it('shows an error when the rewrite call fails', async () => {
      const user = userEvent.setup()
      api.mock('POST /v1/campaigns/mine/story/rewrite', async () => ({
        status: 500,
        data: { rewrite: '' },
      }))

      render(
        <CampaignStoryCard section={section} initialValue="rough background" />,
      )
      await user.click(screen.getByRole('button', { name: /Improve with AI/ }))

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

      render(
        <CampaignStoryCard section={section} initialValue="rough background" />,
      )
      await user.click(screen.getByRole('button', { name: /Improve with AI/ }))

      expect(
        await screen.findByText(/reached your AI rewrite limit/i),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /Improve with AI/ }),
      ).toBeDisabled()
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.CampaignStory.RewriteLimitReached,
        { field: 'background' },
      )
    })
  })
})
