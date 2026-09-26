import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useServeIssueCaptureFlag } from 'app/shared/experiments/serveIssueCaptureFlag'
import PhoneBankingOutcomeForm from './PhoneBankingOutcomeForm'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

vi.mock('app/shared/experiments/serveIssueCaptureFlag', () => ({
  useServeIssueCaptureFlag: vi.fn(),
}))

const mocks = vi.hoisted(() => ({
  input: {
    current: null as null | {
      analyticsLabel: string
      value: string
      onChange: (next: string) => void
    },
  },
}))

vi.mock('app/dashboard/shared/dictation/useDictationAppend', () => ({
  useDictationAppend: (input: {
    analyticsLabel: string
    value: string
    onChange: (next: string) => void
  }) => {
    mocks.input.current = input
    return {
      status: 'idle',
      error: null,
      partialTranscript: '',
      active: false,
      busy: false,
      start: vi.fn(),
      stop: vi.fn(),
      toggle: vi.fn(),
    }
  },
}))

const MEMO = 'Rosa wants the compost bins collected weekly, not fortnightly.'

const ENTRY_ID = 4021

const dictate = (text: string) => act(() => mocks.input.current?.onChange(text))

const renderForm = ({
  isServe = true,
  onSaved = vi.fn(),
}: { isServe?: boolean; onSaved?: () => void } = {}) => {
  const view = render(
    <PhoneBankingOutcomeForm
      listId={9}
      entryId={ENTRY_ID}
      entrySeq={1}
      personId="person-1"
      interaction={null}
      householdHasOthersUnlogged={false}
      isServe={isServe}
      onSaved={onSaved}
    />,
  )
  return { view, onSaved }
}

// A Serve call that connected, engaged and was given a memo, then saved.
const callAndSave = (withMemo = true) => {
  fireEvent.click(screen.getByRole('radio', { name: 'Answered' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Engaged' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Yes' }))
  if (withMemo) dictate(MEMO)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

let captureBodies: { clientKey: string; transcript: string }[] = []

beforeEach(() => {
  testQueryClient.clear()
  vi.mocked(trackEvent).mockClear()
  vi.mocked(useServeIssueCaptureFlag).mockReturnValue({
    ready: true,
    enabled: true,
  })
  mocks.input.current = null
  captureBodies = []

  api.mock('POST /v1/phone-banking/lists/:id/calls', {
    status: 200,
    data: { entryId: ENTRY_ID, results: [], envelopeCompleted: false },
  })
  api.mock('POST /v1/constituent-feedback', ({ body }) => {
    captureBodies.push(body as (typeof captureBodies)[number])
    return {
      status: 200,
      data: {
        id: 'feedback-1',
        personId: 'person-1',
        extractionStatus: 'extracted',
        extraction: {
          issueLabel: 'Compost collection',
          stance: 'mixed',
          desiredOutcome: 'Weekly pickup instead of fortnightly',
        },
      },
    }
  })
  api.mock('PATCH /v1/constituent-feedback/:id/confirm', {
    status: 200,
    data: {
      id: 'feedback-1',
      personId: 'person-1',
      occurredAt: new Date('2026-09-26T00:00:00.000Z'),
      channel: 'phone_bank',
      transcript: MEMO,
      issueLabel: 'Compost collection',
      stance: 'mixed',
      desiredOutcome: 'Weekly pickup instead of fortnightly',
      extractionStatus: 'extracted',
      confirmedAt: new Date('2026-09-26T00:00:01.000Z'),
      actorName: 'Kamal Al Sawafi',
    },
  })
})

describe('PhoneBankingOutcomeForm issue capture', () => {
  // Unlike the door, where the walk is HELD until the triple is answered, the
  // caller is released the moment the call is logged — they pick their own
  // next entry, so there is nothing to hold.
  it('logs the call first, then offers the triple over the top', async () => {
    const { onSaved } = renderForm()
    callAndSave()

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(await screen.findByText('Is this right?')).toBeVisible()
    expect(screen.getByDisplayValue('Compost collection')).toBeVisible()
  })

  it('posts the memo once the call is saved', async () => {
    renderForm()
    callAndSave()

    await waitFor(() => expect(captureBodies).toHaveLength(1))
    expect(captureBodies[0]?.transcript).toBe(MEMO)
  })

  it('does not post anything when the memo is left empty', async () => {
    const { onSaved } = renderForm()
    callAndSave(false)

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(captureBodies).toHaveLength(0)
    expect(screen.queryByText('Is this right?')).toBeNull()
  })

  // The contract types `clientKey` as a guid, and MSW does not validate a
  // request body, so nothing else in this file would notice the day it stops
  // being one. gp-api 400s that, and the memo is lost in silence.
  it('sends a guid as the replay key', async () => {
    renderForm()
    callAndSave()

    await waitFor(() => expect(captureBodies).toHaveLength(1))
    expect(captureBodies[0]?.clientKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it('dismisses the card on confirm', async () => {
    renderForm()
    callAndSave()

    fireEvent.click(await screen.findByRole('button', { name: 'Looks right' }))

    await waitFor(() => expect(screen.queryByText('Is this right?')).toBeNull())
  })

  // A failed confirm leaves the memo saved and unconfirmed, which reporting
  // already tells apart. Stranding the caller on the card is the worse trade.
  it('dismisses the card even when the confirm fails', async () => {
    api.mock('PATCH /v1/constituent-feedback/:id/confirm', {
      status: 500,
      data: { message: 'boom' },
    })
    renderForm()
    callAndSave()

    fireEvent.click(await screen.findByRole('button', { name: 'Looks right' }))

    await waitFor(() => expect(screen.queryByText('Is this right?')).toBeNull())
  })

  // Both surfaces report into one rollup, so a confirm that fires no event
  // would read as a zero confirmation rate for calls rather than as a gap.
  it('reports whether the proposal was corrected, never what it said', async () => {
    renderForm()
    callAndSave()

    const issue = await screen.findByDisplayValue('Compost collection')
    fireEvent.change(issue, { target: { value: 'Bin collection' } })
    fireEvent.click(screen.getByRole('button', { name: 'Looks right' }))

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.ConstituentFeedback.IssueConfirmed,
        { channel: 'phoneBanking', corrected: true },
      ),
    )
  })

  it('reports an untouched proposal as uncorrected', async () => {
    renderForm()
    callAndSave()

    fireEvent.click(await screen.findByRole('button', { name: 'Looks right' }))

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.ConstituentFeedback.IssueConfirmed,
        { channel: 'phoneBanking', corrected: false },
      ),
    )
  })

  it('records a skip and dismisses the card', async () => {
    renderForm()
    callAndSave()

    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ConstituentFeedback.IssueSkipped,
      { channel: 'phoneBanking' },
    )
    await waitFor(() => expect(screen.queryByText('Is this right?')).toBeNull())
  })

  // The call is already logged by the time capture runs, so a capture failure
  // is invisible to the caller rather than an error they have to clear.
  it('never interrupts the caller when capture fails', async () => {
    api.mock('POST /v1/constituent-feedback', {
      status: 500,
      data: { message: 'boom' },
    })
    const { onSaved } = renderForm()
    callAndSave()

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(screen.queryByText('Is this right?')).toBeNull()
  })

  it('asks for no memo when the flag is off', async () => {
    vi.mocked(useServeIssueCaptureFlag).mockReturnValue({
      ready: true,
      enabled: false,
    })
    const { onSaved } = renderForm()

    expect(screen.queryByText('What did they say?')).toBeNull()
    callAndSave(false)

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(captureBodies).toHaveLength(0)
  })

  // Win has no constituents to capture feedback from, and the flag says
  // nothing about that — the surface does.
  it('asks for no memo on the Win surface', async () => {
    renderForm({ isServe: false })

    expect(screen.queryByText('What did they say?')).toBeNull()
  })
})
