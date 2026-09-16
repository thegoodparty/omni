import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import type { ChatClient } from './chatTypes'
import MessageActionBar from './MessageActionBar'

vi.mock('@shared/sentry', () => ({ reportErrorToSentry: vi.fn() }))

const setMessageFeedback = vi.fn()
const clearMessageFeedback = vi.fn()
const writeText = vi.fn()

const client = (overrides: Partial<ChatClient> = {}): ChatClient =>
  ({
    setMessageFeedback,
    clearMessageFeedback,
    ...overrides,
  }) as unknown as ChatClient

const renderBar = (props?: {
  chatApi?: ChatClient
  initialFeedback?: {
    feedback: 'positive' | 'negative'
    comment: string | null
  }
}) =>
  render(
    <MessageActionBar
      conversationId="conv_1"
      messageId="asst_1"
      content="Three items, two of them zoning."
      chatApi={props?.chatApi ?? client()}
      initialFeedback={props?.initialFeedback}
    />,
  )

beforeEach(() => {
  setMessageFeedback.mockReset().mockResolvedValue(undefined)
  clearMessageFeedback.mockReset().mockResolvedValue(undefined)
  writeText.mockReset().mockResolvedValue(undefined)
})

// userEvent.setup() installs its own navigator.clipboard stub, so the spy has
// to land after it.
const stubClipboard = (): void => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
}

describe('<MessageActionBar>', () => {
  // Both writes upsert the same row, so delivery order is the rating. These
  // cover the two ways rapid clicking used to lose one.
  describe('overlapping votes', () => {
    it('delivers two quick opposite votes in click order', async () => {
      const user = userEvent.setup()
      const landed: string[] = []
      const releases: Array<() => void> = []
      setMessageFeedback.mockImplementation((args: { feedback: string }) => {
        return new Promise<void>((resolve) => {
          releases.push(() => {
            landed.push(args.feedback)
            resolve()
          })
        })
      })
      renderBar()

      await user.click(screen.getByRole('button', { name: 'Bad response' }))
      await user.click(screen.getByRole('button', { name: 'Good response' }))

      // Only the first is in flight; the second is queued behind it.
      await waitFor(() => expect(releases).toHaveLength(1))

      // Settle the first request LAST-in-line to prove the queue, not luck,
      // decides the order the server sees.
      releases[0]!()
      await waitFor(() => expect(releases).toHaveLength(2))
      releases[1]!()

      await waitFor(() => expect(landed).toHaveLength(2))
      expect(landed).toEqual(['negative', 'positive'])
    })

    it('a stale vote failure does not un-press the newer thumb', async () => {
      const user = userEvent.setup()
      let failFirst = (): void => {
        throw new Error('first write never started')
      }
      setMessageFeedback.mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            failFirst = () => reject(new Error('offline'))
          }),
      )
      setMessageFeedback.mockImplementationOnce(() => Promise.resolve())
      renderBar()

      await user.click(screen.getByRole('button', { name: 'Bad response' }))
      await user.click(screen.getByRole('button', { name: 'Good response' }))

      // The first vote loses, after the second has already taken the thumb.
      failFirst()

      await waitFor(() => expect(setMessageFeedback).toHaveBeenCalledTimes(2))
      expect(
        screen.getByRole('button', { name: 'Good response' }),
      ).toHaveAttribute('aria-pressed', 'true')
      expect(
        screen.getByRole('button', { name: 'Bad response' }),
      ).toHaveAttribute('aria-pressed', 'false')
    })
  })

  describe('the rating stands on its own', () => {
    it('keeps the note panel open after the rating is recorded', async () => {
      const user = userEvent.setup()
      renderBar()

      await user.click(screen.getByRole('button', { name: 'Bad response' }))

      await waitFor(() => expect(setMessageFeedback).toHaveBeenCalled())
      // The panel must still be there once the write settles — the flash-shut
      // symptom was the rating write failing and closing it.
      expect(screen.getByText('What was wrong?')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Bad response' }),
      ).toHaveAttribute('aria-pressed', 'true')
    })

    it('keeps the rating when the note panel is dismissed unsaved', async () => {
      const user = userEvent.setup()
      renderBar()

      await user.click(screen.getByRole('button', { name: 'Good response' }))
      await user.click(screen.getByRole('button', { name: 'Not now' }))

      expect(screen.queryByText('What did you like?')).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Good response' }),
      ).toHaveAttribute('aria-pressed', 'true')
      // One write — the rating. Dismissing sends nothing and retracts nothing.
      expect(setMessageFeedback).toHaveBeenCalledTimes(1)
      expect(clearMessageFeedback).not.toHaveBeenCalled()
    })

    it('keeps the rating when saving the note fails', async () => {
      const user = userEvent.setup()
      renderBar()

      await user.click(screen.getByRole('button', { name: 'Bad response' }))
      await waitFor(() => expect(setMessageFeedback).toHaveBeenCalledTimes(1))

      setMessageFeedback.mockRejectedValueOnce(new Error('offline'))
      await user.type(screen.getByLabelText('Feedback note'), 'Wrong meeting.')
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(setMessageFeedback).toHaveBeenCalledTimes(2))
      expect(
        screen.getByRole('button', { name: 'Bad response' }),
      ).toHaveAttribute('aria-pressed', 'true')
    })

    it('saves the note after the rating write, never before it', async () => {
      const user = userEvent.setup()
      const order: string[] = []
      // Reassigned by the first mock below, before anything calls it.
      let releaseRating = (): void => {
        throw new Error('rating write never started')
      }
      setMessageFeedback.mockImplementationOnce(
        (args: { comment: string | null }) =>
          new Promise<void>((resolve) => {
            releaseRating = () => {
              order.push(`rating:${String(args.comment)}`)
              resolve()
            }
          }),
      )
      setMessageFeedback.mockImplementationOnce(
        (args: { comment: string | null }) => {
          order.push(`note:${String(args.comment)}`)
          return Promise.resolve()
        },
      )
      renderBar()

      // Rate, then save a note while the rating write is still in flight.
      await user.click(screen.getByRole('button', { name: 'Bad response' }))
      await user.type(screen.getByLabelText('Feedback note'), 'Wrong meeting.')
      await user.click(screen.getByRole('button', { name: 'Save' }))

      releaseRating()

      // Both calls upsert the same row, so the note has to land last or the
      // rating's `comment: null` would silently wipe it.
      await waitFor(() => expect(order).toHaveLength(2))
      expect(order).toEqual(['rating:null', 'note:Wrong meeting.'])
    })
  })

  it('copies the message content to the clipboard', async () => {
    const user = userEvent.setup()
    stubClipboard()
    renderBar()

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith('Three items, two of them zoning.')
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Copied' }),
      ).toBeInTheDocument(),
    )
  })

  it('stores a thumbs-down and opens the note bubble', async () => {
    const user = userEvent.setup()
    renderBar()

    await user.click(screen.getByRole('button', { name: 'Bad response' }))

    expect(setMessageFeedback).toHaveBeenCalledWith({
      conversationId: 'conv_1',
      messageId: 'asst_1',
      feedback: 'negative',
      comment: null,
    })
    expect(screen.getByText('What was wrong?')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Bad response' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('saves the typed note against the rating', async () => {
    const user = userEvent.setup()
    renderBar()

    await user.click(screen.getByRole('button', { name: 'Bad response' }))
    await user.type(screen.getByLabelText('Feedback note'), 'Wrong meeting.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(setMessageFeedback).toHaveBeenLastCalledWith({
        conversationId: 'conv_1',
        messageId: 'asst_1',
        feedback: 'negative',
        comment: 'Wrong meeting.',
      }),
    )
    expect(screen.queryByText('What was wrong?')).not.toBeInTheDocument()
  })

  it('asks what the user liked on a thumbs-up', async () => {
    const user = userEvent.setup()
    renderBar()

    await user.click(screen.getByRole('button', { name: 'Good response' }))

    expect(screen.getByText('What did you like?')).toBeInTheDocument()
  })

  it('restores the rating it was loaded with', () => {
    renderBar({ initialFeedback: { feedback: 'positive', comment: 'Useful.' } })

    expect(
      screen.getByRole('button', { name: 'Good response' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('retracts the rating when the active thumb is tapped again', async () => {
    const user = userEvent.setup()
    renderBar({ initialFeedback: { feedback: 'positive', comment: null } })

    await user.click(screen.getByRole('button', { name: 'Good response' }))

    expect(clearMessageFeedback).toHaveBeenCalledWith({
      conversationId: 'conv_1',
      messageId: 'asst_1',
    })
    expect(
      screen.getByRole('button', { name: 'Good response' }),
    ).toHaveAttribute('aria-pressed', 'false')
  })

  it('reverts the pressed thumb when the write fails', async () => {
    const user = userEvent.setup()
    setMessageFeedback.mockRejectedValue(new Error('offline'))
    renderBar()

    await user.click(screen.getByRole('button', { name: 'Bad response' }))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Bad response' }),
      ).toHaveAttribute('aria-pressed', 'false'),
    )
  })

  it('hides the thumbs on a client without the feedback routes', () => {
    renderBar({
      chatApi: {} as unknown as ChatClient,
    })

    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Good response' }),
    ).not.toBeInTheDocument()
  })
})
