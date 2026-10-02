import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { ConstituentFeedbackRecord } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import PendingMemoList from './PendingMemoList'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const OUTREACH_ID = 41

const row = (
  fields: Partial<ConstituentFeedbackRecord> = {},
): ConstituentFeedbackRecord => ({
  id: 'memo-1',
  personId: 'person-1',
  occurredAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
  channel: 'door_knock',
  transcript: 'She wants the storm drains on Elm cleared before winter.',
  issueLabel: 'Street flooding',
  stance: 'opposes',
  desiredOutcome: 'Clear the drains',
  extractionStatus: 'extracted',
  confirmedAt: null,
  outreachId: OUTREACH_ID,
  actorName: 'Kamal Al Sawafi',
  tags: [],
  ...fields,
})

const STILL_TRANSCRIBING = row({
  id: 'memo-2',
  transcript: null,
  issueLabel: null,
  stance: null,
  desiredOutcome: null,
  extractionStatus: 'pending',
})

const NOT_HEARD = row({
  id: 'memo-3',
  transcript: null,
  issueLabel: null,
  stance: null,
  desiredOutcome: null,
  extractionStatus: 'failed',
})

const mockPending = (feedback: ConstituentFeedbackRecord[]) =>
  api.mock('GET /v1/constituent-feedback/pending', ({ query }) => {
    expect(query.outreachId).toBe(String(OUTREACH_ID))
    return { status: 200, data: { feedback } }
  })

const renderList = (isServe = false) =>
  render(<PendingMemoList outreachId={OUTREACH_ID} isServe={isServe} />)

beforeEach(() => {
  testQueryClient.clear()
  vi.mocked(trackEvent).mockClear()
})

describe('PendingMemoList', () => {
  it('shows each note to review with its card under what was said', async () => {
    mockPending([
      row(),
      row({
        id: 'memo-4',
        transcript: 'He wants the bike lanes kept.',
        issueLabel: 'Bike lanes',
        stance: 'supports',
      }),
    ])
    renderList()

    expect(
      await screen.findByText(
        'She wants the storm drains on Elm cleared before winter.',
      ),
    ).toBeVisible()
    expect(screen.getByText('He wants the bike lanes kept.')).toBeVisible()
    expect(screen.getAllByText('Is this right?')).toHaveLength(2)
    expect(screen.getByDisplayValue('Street flooding')).toBeVisible()
    expect(screen.getByDisplayValue('Bike lanes')).toBeVisible()
  })

  // Nothing has been pulled out of it yet, so there is nothing to confirm.
  it('says a note is still transcribing, with no card', async () => {
    mockPending([STILL_TRANSCRIBING])
    renderList()

    expect(await screen.findByText('Still transcribing')).toBeVisible()
    expect(screen.queryByText('Is this right?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('confirms a note with the fields as they stand', async () => {
    mockPending([row()])
    let patched: unknown = null
    api.mock(
      'PATCH /v1/constituent-feedback/:id/confirm',
      ({ params, body }) => {
        patched = { id: params.id, body }
        return { status: 200, data: row({ confirmedAt: new Date() }) }
      },
    )
    renderList()

    fireEvent.click(await screen.findByRole('button', { name: 'Looks right' }))

    await waitFor(() =>
      expect(patched).toEqual({
        id: 'memo-1',
        body: {
          issueLabel: 'Street flooding',
          stance: 'opposes',
          desiredOutcome: 'Clear the drains',
        },
      }),
    )
    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.IssueCapture.PendingMemoConfirmed,
        { channel: 'doorKnocking', product: 'win', ageHours: 2 },
      ),
    )
  })

  it('tries a note that could not be heard again', async () => {
    mockPending([NOT_HEARD])
    let retried: unknown = null
    api.mock('POST /v1/constituent-feedback/:id/retry', ({ params, body }) => {
      retried = { id: params.id, body }
      return {
        status: 200,
        data: { ...NOT_HEARD, extractionStatus: 'pending' },
      }
    })
    renderList()

    expect(
      await screen.findByText(
        "We couldn't make out this note. Try again or type it.",
      ),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(retried).toEqual({ id: 'memo-3', body: {} }))
  })

  // Typing it saves only what was typed, through the same confirm.
  it('takes a note typed by hand', async () => {
    mockPending([NOT_HEARD])
    let patched: unknown = null
    api.mock(
      'PATCH /v1/constituent-feedback/:id/confirm',
      ({ params, body }) => {
        patched = { id: params.id, body }
        return { status: 200, data: row({ confirmedAt: new Date() }) }
      },
    )
    renderList()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Type it instead' }),
    )
    fireEvent.change(screen.getByPlaceholderText('What they talked about'), {
      target: { value: 'Potholes' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Against it' }))
    fireEvent.click(screen.getByRole('button', { name: 'Looks right' }))

    await waitFor(() =>
      expect(patched).toEqual({
        id: 'memo-3',
        body: {
          issueLabel: 'Potholes',
          stance: 'opposes',
          desiredOutcome: null,
        },
      }),
    )
  })

  it('says when there is nothing to review', async () => {
    mockPending([])
    renderList()

    expect(
      await screen.findByText('Nothing to review. New notes show up here.'),
    ).toBeVisible()
  })

  // Win never says constituent and Serve never says voter, on any state.
  it.each([
    [false, /constituent/i],
    [true, /voter/i],
  ])('keeps to its product’s words (Serve: %s)', async (isServe, banned) => {
    mockPending([row(), STILL_TRANSCRIBING, NOT_HEARD])
    const { container } = renderList(isServe)

    await screen.findByText('Still transcribing')
    expect(container.textContent).not.toMatch(banned)
  })
})
