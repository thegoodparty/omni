import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { installIndexedDbShim } from 'helpers/test-utils/indexedDbShim'
import {
  enqueue,
  listQueue,
  removeFromQueue,
} from 'app/(dashboard)/shared/dictation/offlineMemoQueue'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useIssueCaptureFlag } from 'app/shared/experiments/issueCaptureFlag'
import type { PhoneBankingInteraction } from '@goodparty_org/contracts'
import PhoneBankingOutcomeForm, {
  type CallDraft,
} from './PhoneBankingOutcomeForm'
import type { UnsavedDrafts } from 'app/(dashboard)/shared/useUnsavedDrafts'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

// Passed through, and watched: with the flag off a save must not touch the
// phone's queue at all.
vi.mock(
  'app/(dashboard)/shared/dictation/offlineMemoQueue',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('app/(dashboard)/shared/dictation/offlineMemoQueue')
      >()
    return {
      ...actual,
      enqueue: vi.fn(actual.enqueue),
      removeFromQueue: vi.fn(actual.removeFromQueue),
    }
  },
)

vi.mock('app/shared/experiments/issueCaptureFlag', () => ({
  useIssueCaptureFlag: vi.fn(),
}))

const setFlag = (enabled: boolean) => {
  vi.mocked(useIssueCaptureFlag).mockReturnValue({ ready: true, enabled })
}

const mocks = vi.hoisted(() => ({
  input: {
    current: null as null | {
      analyticsLabel: string
      value: string
      onChange: (next: string) => void
    },
  },
}))

vi.mock('app/(dashboard)/shared/dictation/useDictationAppend', () => ({
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
  setFlag(true)
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
          issues: [
            {
              id: 'issue-compost-collection',
              position: 0,
              issueLabel: 'Compost collection',
              stance: 'mixed',
              desiredOutcome: 'Weekly pickup instead of fortnightly',
            },
          ],
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
      issues: [
        {
          id: 'issue-compost-collection',
          position: 0,
          issueLabel: 'Compost collection',
          stance: 'mixed',
          desiredOutcome: 'Weekly pickup instead of fortnightly',
        },
      ],
      extractionStatus: 'extracted',
      confirmedAt: new Date('2026-09-26T00:00:01.000Z'),
      outreachId: 7,
      actorName: 'Kamal Al Sawafi',
      tags: [],
    },
  })
})

describe('PhoneBankingOutcomeForm issue capture', () => {
  // Unlike the door, where the walk is HELD until the issues are answered, the
  // caller is released the moment the call is logged — they pick their own
  // next entry, so there is nothing to hold.
  it('logs the call first, then offers the issues over the top', async () => {
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
        EVENTS.IssueCapture.MemoConfirmed,
        {
          channel: 'phoneBanking',
          corrected: true,
          issueCount: 1,
          product: 'serve',
        },
      ),
    )
  })

  it('reports an untouched proposal as uncorrected', async () => {
    renderForm()
    callAndSave()

    fireEvent.click(await screen.findByRole('button', { name: 'Looks right' }))

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.IssueCapture.MemoConfirmed,
        {
          channel: 'phoneBanking',
          corrected: false,
          issueCount: 1,
          product: 'serve',
        },
      ),
    )
  })

  it('records a skip and dismisses the card', async () => {
    renderForm()
    callAndSave()

    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))

    expect(trackEvent).toHaveBeenCalledWith(EVENTS.IssueCapture.MemoSkipped, {
      channel: 'phoneBanking',
      product: 'serve',
    })
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
            issues: [
              {
                id: 'issue-compost-collection',
                position: 0,
                issueLabel: 'Compost collection',
                stance: 'mixed',
                desiredOutcome: 'Weekly pickup instead of fortnightly',
              },
            ],
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

    expect(screen.getByPlaceholderText(/issues and positions/i)).toHaveValue('')
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

    fireEvent.change(screen.getByPlaceholderText(/issues and positions/i), {
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
    setFlag(false)
    const { onSaved } = renderForm()

    expect(screen.queryByText('What did they say?')).toBeNull()
    callAndSave(false)

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(captureBodies).toHaveLength(0)
  })

  it('never says voter on the confirm card', async () => {
    renderForm()
    callAndSave()

    await screen.findByText('Is this right?')
    expect(document.body.textContent ?? '').not.toMatch(/voter/i)
  })

  it('reports the memo as a Serve one', async () => {
    renderForm()
    callAndSave()

    await screen.findByText('Is this right?')
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.IssueCapture.MemoRecorded, {
      channel: 'phoneBanking',
      captureMethod: 'dictation',
      extractionStatus: 'extracted',
      product: 'serve',
    })
  })
})

// A candidate's call list, where the memo is what a voter told the caller.
// Same form, same flag.
describe('PhoneBankingOutcomeForm issue capture on a Win call', () => {
  // Support, then turnout: the will-vote row only opens once support is in,
  // so its "Yes" is the second one on screen.
  const answerWinQuestions = () => {
    fireEvent.click(screen.getByRole('radio', { name: 'Answered' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Engaged' }))
    fireEvent.click(
      screen.getAllByRole('radio', { name: 'Yes' })[0] as HTMLElement,
    )
    fireEvent.click(
      screen.getAllByRole('radio', { name: 'Yes' })[1] as HTMLElement,
    )
  }

  const winCallAndSave = () => {
    answerWinQuestions()
    dictate(MEMO)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  }

  beforeEach(() => {
    setFlag(true)
  })

  it('captures and confirms on a Win call', async () => {
    const { onSaved } = renderForm({ isServe: false })
    winCallAndSave()

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    await waitFor(() => expect(captureBodies).toHaveLength(1))
    expect(captureBodies[0]?.transcript).toBe(MEMO)

    fireEvent.click(await screen.findByRole('button', { name: 'Looks right' }))

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.IssueCapture.MemoConfirmed,
        {
          channel: 'phoneBanking',
          corrected: false,
          issueCount: 1,
          product: 'win',
        },
      ),
    )
  })

  it('asks for no memo on a Win call when the flag is off', () => {
    setFlag(false)
    renderForm({ isServe: false })
    answerWinQuestions()

    expect(screen.queryByText('Their note')).toBeNull()
    expect(screen.queryByPlaceholderText('What did they tell you?')).toBeNull()
  })

  it('asks what they told you, in Win’s words', () => {
    renderForm({ isServe: false })
    answerWinQuestions()

    // One question on screen: the placeholder asks it, the label names it.
    expect(screen.getByText('Their note')).toBeVisible()
    expect(screen.queryByText('What did they say?')).toBeNull()
    expect(screen.getByPlaceholderText('What did they tell you?')).toBeVisible()
    expect(document.body.textContent ?? '').not.toMatch(/constituent/i)
  })

  it('reports the skip as a Win one', async () => {
    renderForm({ isServe: false })
    winCallAndSave()

    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))

    expect(trackEvent).toHaveBeenCalledWith(EVENTS.IssueCapture.MemoSkipped, {
      channel: 'phoneBanking',
      product: 'win',
    })
  })
})

// No signal: the call and its memo wait on the phone, call first, and the
// caller is told so in place of a confirm card.
describe('PhoneBankingOutcomeForm issue capture with no signal', () => {
  let online = false

  beforeEach(() => {
    installIndexedDbShim()
    online = false
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => online,
    })
  })

  afterEach(() => {
    online = true
  })

  it('holds the call and the memo on the phone and says so', async () => {
    const calls = vi.fn()
    api.mock('POST /v1/phone-banking/lists/:id/calls', () => {
      calls()
      return {
        status: 200,
        data: { entryId: ENTRY_ID, results: [], envelopeCompleted: false },
      }
    })
    const { onSaved } = renderForm()
    callAndSave()

    expect(
      await screen.findByText(
        'Saved on your device. It will be sent when you have signal.',
      ),
    ).toBeVisible()
    expect(calls).not.toHaveBeenCalled()
    expect(captureBodies).toEqual([])
    // The list moves on now, with what the server will record.
    expect(onSaved).toHaveBeenCalledWith([
      {
        personId: 'person-1',
        interaction: {
          outcome: 'answered',
          supportAnswer: null,
          willVote: null,
          followUp: 'yes',
          occurredAt: expect.any(Date),
        },
      },
    ])
    expect(screen.queryByText('Is this right?')).toBeNull()

    const queued = await listQueue()
    const call = queued.find((entry) => entry.kind === 'call')
    const memo = queued.find((entry) => entry.kind === 'memo')
    expect(call?.id).toBe(`call:${ENTRY_ID}:person-1`)
    expect(call?.payload).toEqual({
      listId: 9,
      request: {
        entryId: ENTRY_ID,
        outcome: 'answered',
        personId: 'person-1',
        followUp: 'yes',
      },
    })
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.PhoneBanking.CallLogged,
      expect.objectContaining({ answerStatus: 'answered' }),
    )
    expect(memo?.id).toBe(`memo:${ENTRY_ID}:person-1`)
    expect(memo?.payload).toEqual({
      reference: {
        channel: 'phone_bank',
        entryId: ENTRY_ID,
        personId: 'person-1',
        clientKey: expect.any(String),
      },
      text: { transcript: MEMO, captureMethod: 'dictation' },
      analytics: { channel: 'phoneBanking', product: 'serve' },
    })
  })

  it('drops the answers of a call held after the caller switched away', async () => {
    const store = new Map<string, CallDraft>()
    const drafts: UnsavedDrafts<CallDraft> = {
      get: (key) => store.get(key),
      set: (key, draft) => {
        store.set(key, draft)
      },
      clear: (key) => {
        store.delete(key)
      },
    }
    const onSaved = vi.fn()
    const form = (interaction: PhoneBankingInteraction | null) => (
      <PhoneBankingOutcomeForm
        listId={9}
        entryId={ENTRY_ID}
        entrySeq={1}
        personId="person-1"
        interaction={interaction}
        householdHasOthersUnlogged={false}
        isServe
        onSaved={onSaved}
        drafts={drafts}
      />
    )
    const view = render(form(null))
    callAndSave()
    view.unmount()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())

    render(form(LOGGED))

    expect(screen.queryByText('Did they answer?')).toBeNull()
    expect(store.has(`${ENTRY_ID}:person-1`)).toBe(false)
  })
})

describe('PhoneBankingOutcomeForm drafts', () => {
  // A switch away in the same tick as Cancel unmounts before the ref that
  // tracks unsaved answers has caught up, so Cancel has to clear it itself.
  it('keeps nothing for a call cancelled as the caller switches away', () => {
    const store = new Map<string, CallDraft>()
    const drafts: UnsavedDrafts<CallDraft> = {
      get: (key) => store.get(key),
      set: (key, draft) => {
        store.set(key, draft)
      },
      clear: (key) => {
        store.delete(key)
      },
    }
    const view = render(
      <PhoneBankingOutcomeForm
        listId={9}
        entryId={ENTRY_ID}
        entrySeq={1}
        personId="person-1"
        interaction={null}
        householdHasOthersUnlogged={false}
        isServe
        onSaved={vi.fn()}
        drafts={drafts}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Answered' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Engaged' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }))
    dictate(MEMO)

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      view.unmount()
    })

    expect(store.has(`${ENTRY_ID}:person-1`)).toBe(false)
  })
})

describe('PhoneBankingOutcomeForm with capture off', () => {
  // The form is exactly what it was: an online save does not wait on the
  // phone's storage.
  it('leaves the queue alone on an online save', async () => {
    setFlag(false)
    vi.mocked(enqueue).mockClear()
    vi.mocked(removeFromQueue).mockClear()
    const { onSaved } = renderForm()
    callAndSave(false)

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(removeFromQueue).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })
})
