import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useServeIssueCaptureFlag } from 'app/shared/experiments/serveIssueCaptureFlag'
import type { PhoneBankingInteraction } from '@goodparty_org/contracts'
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

const formWith = (
  isServe: boolean,
  onSaved: () => void,
  interaction: PhoneBankingInteraction | null,
) => (
  <PhoneBankingOutcomeForm
    listId={9}
    entryId={ENTRY_ID}
    entrySeq={1}
    personId="person-1"
    interaction={interaction}
    householdHasOthersUnlogged={false}
    isServe={isServe}
    onSaved={onSaved}
  />
)

const renderForm = ({
  isServe = true,
  onSaved = vi.fn(),
}: { isServe?: boolean; onSaved?: () => void } = {}) => {
  const view = render(formWith(isServe, onSaved, null))
  return { view, onSaved, isServe }
}

// What the parent hands back once the call is logged. Re-rendering with it
// (rather than remounting) is what the panel really does: the key is personId,
// so pressing the pencil reopens the SAME instance.
const LOGGED: PhoneBankingInteraction = {
  outcome: 'answered',
  supportAnswer: null,
  willVote: null,
  followUp: 'yes',
  occurredAt: new Date('2026-09-26T00:00:00.000Z'),
}

// A Serve call that connected, engaged and was given a memo, then saved.
const callAndSave = (withMemo = true) => {
  fireEvent.click(screen.getByRole('radio', { name: 'Answered' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Engaged' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Yes' }))
  if (withMemo) dictate(MEMO)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

let captureBodies: {
  clientKey: string
  transcript: string
  captureMethod: string
}[] = []

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

  // The call is already logged by the time capture runs, so a failure must
  // not block the caller — but it must not be silent either. The call payload
  // carries no memo, so a dropped capture loses the words outright.
  it('releases the caller but says the memo did not save', async () => {
    api.mock('POST /v1/constituent-feedback', {
      status: 500,
      data: { message: 'boom' },
    })
    const { view, onSaved } = renderForm()
    callAndSave()

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(screen.queryByText('Is this right?')).toBeNull()

    view.rerender(formWith(true, onSaved, LOGGED))
    expect(
      await screen.findByText(/Couldn't save what they said/i),
    ).toBeVisible()
  })

  // The retry has to carry the ORIGINAL transcript: the memo box was cleared
  // on save, so if the failure did not hold these words nothing would.
  it('retries the failed memo with the words it lost', async () => {
    api.mock('POST /v1/constituent-feedback', {
      status: 500,
      data: { message: 'boom' },
    })
    const { view, onSaved } = renderForm()
    callAndSave()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())

    view.rerender(formWith(true, onSaved, LOGGED))
    await screen.findByText(/Couldn't save what they said/i)

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
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(captureBodies).toHaveLength(1))
    expect(captureBodies[0]?.transcript).toBe(MEMO)
    expect(captureBodies[0]?.captureMethod).toBe('dictation')
    await waitFor(() =>
      expect(screen.queryByText(/Couldn't save what they said/i)).toBeNull(),
    )
  })

  // `answered` is only the branch into the engagement question. Refused and
  // hung up are person-attributed non-conversations, so there is nothing a
  // constituent said to capture.
  it.each(['Refused', 'Hung up'])(
    'asks for no memo on a call the constituent %s',
    async (engagement) => {
      renderForm()
      fireEvent.click(screen.getByRole('radio', { name: 'Answered' }))
      fireEvent.click(
        screen.getAllByRole('radio', { name: engagement })[1] as HTMLElement,
      )

      expect(screen.queryByText('What did they say?')).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(captureBodies).toHaveLength(0))
    },
  )

  // Re-editing through the pencil toggles `isEditing` on a live instance
  // rather than remounting, so anything left in memo state rides along.
  it('reopens an edited call with an empty memo box', async () => {
    const { view, onSaved } = renderForm()
    callAndSave()
    await waitFor(() => expect(captureBodies).toHaveLength(1))

    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))
    view.rerender(formWith(true, onSaved, LOGGED))
    fireEvent.click(
      await screen.findByRole('button', { name: "Edit this call's outcome" }),
    )

    expect(screen.getByPlaceholderText(/Say it out loud/i)).toHaveValue('')
  })

  // `spoken` is what decides `captureMethod`, and it is sticky: a first memo
  // that was dictated would report the typed second one as dictation too.
  it('reports a typed second memo as typed, not dictated', async () => {
    const { view, onSaved } = renderForm()
    callAndSave()
    await waitFor(() => expect(captureBodies).toHaveLength(1))
    expect(captureBodies[0]?.captureMethod).toBe('dictation')

    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))
    view.rerender(formWith(true, onSaved, LOGGED))
    fireEvent.click(
      await screen.findByRole('button', { name: "Edit this call's outcome" }),
    )

    fireEvent.change(screen.getByPlaceholderText(/Say it out loud/i), {
      target: { value: 'Typed this one out instead.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(captureBodies).toHaveLength(2))
    expect(captureBodies[1]?.captureMethod).toBe('typed')
  })

  // react-query refreshes a mutation's callbacks every render, so `onSuccess`
  // runs against the latest closure — and nothing disables the pills while the
  // save is in flight. Editing the engagement mid-save must not retroactively
  // decide that the memo already typed should be thrown away.
  it('still captures when the engagement is changed mid-save', async () => {
    // A deferred the mock awaits, so the save is genuinely in flight while
    // the pill is clicked. Held in an object rather than a bare `let`: a
    // null-initialised local narrows to `never` across the await, and a
    // no-op initialiser trips no-empty-function.
    const gate: { release: () => void } = { release: () => undefined }
    const inFlight = new Promise<void>((resolve) => {
      gate.release = resolve
    })
    let saveStarted = false
    api.mock('POST /v1/phone-banking/lists/:id/calls', async () => {
      saveStarted = true
      await inFlight
      return {
        status: 200,
        data: { entryId: ENTRY_ID, results: [], envelopeCompleted: false },
      }
    })

    const { onSaved } = renderForm()
    callAndSave()
    await waitFor(() => expect(saveStarted).toBe(true))

    // The caller fumbles a pill while the request is still out.
    fireEvent.click(
      screen.getAllByRole('radio', { name: 'Refused' })[1] as HTMLElement,
    )
    gate.release()

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    await waitFor(() => expect(captureBodies).toHaveLength(1))
    expect(captureBodies[0]?.transcript).toBe(MEMO)
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
