import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { PendingFeedback } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { REPORT_POLL_INTERVAL_MS, reportQueryKey } from '../../queries'
import PendingMemoList from './PendingMemoList'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const OUTREACH_ID = 41

const KNOCK_KEY = '6f1d7a9c-3f1e-4f0a-9f4e-2f5a6b7c8d90'

const row = (fields: Partial<PendingFeedback> = {}): PendingFeedback => ({
  id: 'memo-1',
  personId: 'person-1',
  occurredAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
  channel: 'door_knock',
  transcript: 'She wants the storm drains on Elm cleared before winter.',
  issues: [
    {
      id: 'issue-street-flooding',
      position: 0,
      issueLabel: 'Street flooding',
      stance: 'opposes',
      desiredOutcome: 'Clear the drains',
    },
  ],
  extractionStatus: 'extracted',
  confirmedAt: null,
  outreachId: OUTREACH_ID,
  actorName: 'Kamal Al Sawafi',
  tags: [],
  clientKey: KNOCK_KEY,
  reference: {
    channel: 'door_knock',
    knockClientKey: KNOCK_KEY,
    stopTargetId: 21,
  },
  ...fields,
})

const STILL_TRANSCRIBING = row({
  id: 'memo-2',
  transcript: null,
  issues: [],
  extractionStatus: 'pending',
})

const NOT_HEARD = row({
  id: 'memo-3',
  transcript: null,
  issues: [],
  extractionStatus: 'failed',
})

const mockPending = (feedback: PendingFeedback[]) =>
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

afterEach(() => {
  vi.useRealTimers()
})

describe('PendingMemoList', () => {
  // The manager's page names itself in its title bar and holds the way back
  // in its top bar, so the list leaves both to it and opens on the caption.
  it('leaves the title and the way back to a page that has its own', async () => {
    mockPending([row()])
    render(
      <PendingMemoList
        outreachId={OUTREACH_ID}
        isServe={false}
        titled={false}
      />,
    )

    expect(
      await screen.findByText('Check what each note says, then confirm it.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Notes to review' }),
    ).toBeNull()
    expect(
      screen.queryByRole('link', { name: 'Back to what we heard' }),
    ).toBeNull()
  })

  it('shows each note to review with its card under what was said', async () => {
    mockPending([
      row(),
      row({
        id: 'memo-4',
        transcript: 'He wants the bike lanes kept.',
        issues: [
          {
            id: 'issue-bike-lanes',
            position: 0,
            issueLabel: 'Bike lanes',
            stance: 'supports',
            desiredOutcome: null,
          },
        ],
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

    expect(
      await screen.findByText('Still transcribing', {
        selector: 'p:not([role="status"])',
      }),
    ).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Still transcribing')
    expect(screen.queryByText('Is this right?')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Try again/ })).toBeNull()
  })

  it('flips a note from still transcribing to ready to review in place', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.mockOrdered('GET /v1/constituent-feedback/pending', [
      { status: 200, data: { feedback: [STILL_TRANSCRIBING] } },
      {
        status: 200,
        data: {
          feedback: [
            row({ id: STILL_TRANSCRIBING.id, transcript: 'Fix the drains.' }),
          ],
        },
      },
    ])
    renderList()

    await screen.findAllByText('Still transcribing')
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Still transcribing')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REPORT_POLL_INTERVAL_MS)
    })

    await waitFor(() => expect(status).toHaveTextContent('Ready to review'))
    expect(status).toBeInTheDocument()
    expect(screen.getByText('Is this right?')).toBeVisible()
  })

  it('takes a confirmed note off the list and re-reads the report', async () => {
    api.mockOrdered('GET /v1/constituent-feedback/pending', [
      { status: 200, data: { feedback: [row()] } },
      { status: 200, data: { feedback: [] } },
    ])
    api.mock('PATCH /v1/constituent-feedback/:id/confirm', {
      status: 200,
      data: row({ confirmedAt: new Date() }),
    })
    testQueryClient.setQueryData(reportQueryKey(OUTREACH_ID), {
      denominators: {},
    })
    renderList()

    fireEvent.click(await screen.findByRole('button', { name: /^Looks right/ }))

    expect(
      await screen.findByText('Nothing to review. New notes show up here.'),
    ).toBeVisible()
    expect(
      screen.queryByText(
        'She wants the storm drains on Elm cleared before winter.',
      ),
    ).toBeNull()
    expect(
      testQueryClient.getQueryState(reportQueryKey(OUTREACH_ID))?.isInvalidated,
    ).toBe(true)
  })

  it('heads a note still transcribing as recorded, not summarized', async () => {
    mockPending([STILL_TRANSCRIBING])
    renderList()

    expect(await screen.findByText('Recorded by Kamal Al Sawafi')).toBeVisible()
    expect(screen.queryByText(/Summary by/)).toBeNull()
  })

  it('heads a failed note as recorded, not summarized', async () => {
    mockPending([NOT_HEARD])
    renderList()

    expect(await screen.findByText('Recorded by Kamal Al Sawafi')).toBeVisible()
    expect(screen.queryByText(/Summary by/)).toBeNull()
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

    fireEvent.click(await screen.findByRole('button', { name: /^Looks right/ }))

    await waitFor(() =>
      expect(patched).toEqual({
        id: 'memo-1',
        body: {
          issues: [
            {
              issueLabel: 'Street flooding',
              stance: 'opposes',
              desiredOutcome: 'Clear the drains',
              fromIssueId: 'issue-street-flooding',
            },
          ],
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
    fireEvent.click(screen.getByRole('button', { name: /^Try again/ }))

    await waitFor(() => expect(retried).toEqual({ id: 'memo-3', body: {} }))
  })

  // A typed note has to become a transcript, which is what synthesis
  // groups, so it is recorded again as typed text and extracted like any
  // other, and the card then offers what was pulled from it.
  it('records a typed note in place of one that could not be heard', async () => {
    const typed = 'He wants the potholes on Oak filled before winter.'
    api.mockOrdered('GET /v1/constituent-feedback/pending', [
      { status: 200, data: { feedback: [NOT_HEARD] } },
      {
        status: 200,
        data: {
          feedback: [
            row({
              id: 'memo-3',
              transcript: typed,
              issues: [
                {
                  id: 'issue-potholes',
                  position: 0,
                  issueLabel: 'Potholes',
                  stance: 'opposes',
                  desiredOutcome: 'Fill the potholes on Oak',
                },
              ],
            }),
          ],
        },
      },
    ])
    let posted: unknown = null
    api.mock('POST /v1/constituent-feedback', ({ body }) => {
      posted = body
      return {
        status: 200,
        data: {
          id: 'memo-3',
          personId: 'person-1',
          extractionStatus: 'extracted',
          extraction: {
            issues: [
              {
                id: 'issue-potholes',
                position: 0,
                issueLabel: 'Potholes',
                stance: 'opposes',
                desiredOutcome: 'Fill the potholes on Oak',
              },
            ],
          },
        },
      }
    })
    renderList()

    fireEvent.click(
      await screen.findByRole('button', { name: /^Type it instead/ }),
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Their note' }), {
      target: { value: typed },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))

    await waitFor(() =>
      expect(posted).toEqual({
        channel: 'door_knock',
        knockClientKey: KNOCK_KEY,
        stopTargetId: 21,
        clientKey: KNOCK_KEY,
        transcript: typed,
        captureMethod: 'typed',
      }),
    )
    expect(await screen.findByText(typed)).toBeVisible()
    expect(screen.getByDisplayValue('Potholes')).toBeVisible()
    expect(screen.getByDisplayValue('Fill the potholes on Oak')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /^Type it instead/ }),
    ).toBeNull()
  })

  // Its knock or call is gone, so there is nothing to record it against.
  it('offers no typing for a note that cannot be recorded again', async () => {
    mockPending([{ ...NOT_HEARD, reference: null }])
    renderList()

    expect(
      await screen.findByRole('button', { name: /^Try again/ }),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /^Type it instead/ }),
    ).toBeNull()
  })

  // A page of these reads, to a screen reader, as one button name said
  // several times unless each says which note it acts on.
  it('names each note’s buttons by its first words, or by who took it', async () => {
    mockPending([row(), NOT_HEARD])
    renderList()

    expect(
      await screen.findByRole('button', {
        name: 'Looks right: She wants the storm drains on…',
      }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', {
        name: /^Try again: Note from Kamal Al Sawafi, /,
      }),
    ).toBeVisible()
    expect(
      screen.getAllByRole('status').map((region) => region.textContent ?? ''),
    ).toContain('Ready to review')
  })

  it('reads a failed retry out as an alert', async () => {
    mockPending([NOT_HEARD])
    api.mock('POST /v1/constituent-feedback/:id/retry', {
      status: 500,
      data: { message: 'boom' },
    })
    renderList()

    fireEvent.click(await screen.findByRole('button', { name: /^Try again/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "That didn't work. Try again in a moment.",
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

    await screen.findAllByText('Still transcribing')
    expect(container.textContent).not.toMatch(banned)
  })
})
