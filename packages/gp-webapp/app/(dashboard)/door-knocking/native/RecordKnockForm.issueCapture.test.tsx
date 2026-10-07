import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { RoutePayloadTarget } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { http, HttpResponse } from 'msw'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import { installIndexedDbShim } from 'helpers/test-utils/indexedDbShim'
import {
  enqueue,
  listQueue,
  removeFromQueue,
} from 'app/(dashboard)/shared/dictation/offlineMemoQueue'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useIssueCaptureFlag } from 'app/shared/experiments/issueCaptureFlag'
import { reportQueryKey } from 'app/(dashboard)/issue-capture/[outreachId]/queries'
import RecordKnockForm, { type KnockDraft } from './RecordKnockForm'
import type { UnsavedDrafts } from 'app/(dashboard)/shared/useUnsavedDrafts'
import { DoorKnockingSurfaceProvider } from './doorKnockingSurface'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

vi.mock('app/shared/experiments/issueCaptureFlag', () => ({
  useIssueCaptureFlag: vi.fn(),
}))

const setFlag = (enabled: boolean) => {
  vi.mocked(useIssueCaptureFlag).mockReturnValue({ ready: true, enabled })
}

const mocks = vi.hoisted(() => ({
  successSnackbar: vi.fn(),
  start: vi.fn(),
  input: {
    current: null as null | {
      analyticsLabel: string
      value: string
      onChange: (next: string) => void
    },
  },
}))

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

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: mocks.successSnackbar,
    errorSnackbar: vi.fn(),
  }),
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
      start: mocks.start,
      stop: vi.fn(),
      toggle: vi.fn(),
    }
  },
}))

const target: RoutePayloadTarget = {
  stopTargetId: 21,
  personId: 'person-1',
  name: 'Dorian Fen',
  age: 31,
  politicalParty: null,
  cellPhone: null,
  landline: null,
  knockStatus: 'unknown',
  mayHaveMoved: false,
  doNotKnock: false,
}

const MEMO = 'Bob is against the Flock cameras, wants the data deleted.'

const FLOCK = {
  id: 'issue-flock-cameras',
  position: 0,
  issueLabel: 'Flock cameras',
  stance: 'opposes' as const,
  desiredOutcome: 'Remove them and delete the data',
}

const dictate = (text: string) => act(() => mocks.input.current?.onChange(text))

const question = (label: string) =>
  within(screen.getByText(label).parentElement as HTMLElement)

const answer = (label: string, option: string) =>
  fireEvent.click(question(label).getByRole('radio', { name: option }))

const renderForm = (onRecorded = vi.fn(), serveMode = true) => {
  render(
    <DoorKnockingSurfaceProvider value={serveMode}>
      <RecordKnockForm
        target={target}
        turfId={1}
        clientKey="6f1d7a9c-3f1e-4f0a-9f4e-2f5a6b7c8d90"
        onRecorded={onRecorded}
      />
    </DoorKnockingSurfaceProvider>,
  )
  return onRecorded
}

// The walk's store, as a plain map the test can read after an unmount.
const draftStore = () => {
  const store = new Map<string, KnockDraft>()
  const drafts: UnsavedDrafts<KnockDraft> = {
    get: (key) => store.get(key),
    set: (key, draft) => {
      store.set(key, draft)
    },
    clear: (key) => {
      store.delete(key)
    },
  }
  return { store, drafts }
}

const formWithDrafts = (
  drafts: UnsavedDrafts<KnockDraft>,
  onRecorded = vi.fn(),
) => (
  <DoorKnockingSurfaceProvider value={true}>
    <RecordKnockForm
      target={target}
      turfId={1}
      clientKey="6f1d7a9c-3f1e-4f0a-9f4e-2f5a6b7c8d90"
      onRecorded={onRecorded}
      drafts={drafts}
    />
  </DoorKnockingSurfaceProvider>
)

// A Serve door with a conversation and a dictated memo, saved.
const walkAndSave = async () => {
  answer('Did they answer?', 'Answered')
  answer('Did they engage?', 'Engaged')
  answer('Do they need follow-up?', 'Yes')
  dictate(MEMO)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

beforeEach(() => {
  testQueryClient.clear()
  vi.mocked(trackEvent).mockClear()
  setFlag(true)
  mocks.input.current = null
  api.mock('POST /v1/door-knocking/interactions', {
    status: 200,
    data: { personId: 'person-1', knockStatus: 'needs_follow_up' },
  })
  api.mock('POST /v1/constituent-feedback', {
    status: 200,
    data: {
      id: 'feedback-1',
      personId: 'person-1',
      extractionStatus: 'extracted',
      extraction: { issues: [FLOCK] },
    },
  })
  api.mock('PATCH /v1/constituent-feedback/:id/confirm', {
    status: 200,
    data: {
      id: 'feedback-1',
      personId: 'person-1',
      occurredAt: new Date('2026-09-25T00:00:00.000Z'),
      channel: 'door_knock',
      transcript: MEMO,
      issues: [FLOCK],
      extractionStatus: 'extracted',
      confirmedAt: new Date('2026-09-25T00:00:01.000Z'),
      outreachId: 7,
      actorName: 'Kamal Al Sawafi',
      tags: [],
    },
  })
})

describe('RecordKnockForm issue capture', () => {
  it('offers the extracted issue for confirmation instead of advancing', async () => {
    const onRecorded = renderForm()
    await walkAndSave()

    expect(await screen.findByText('Is this right?')).toBeVisible()
    expect(screen.getByDisplayValue('Flock cameras')).toBeVisible()
    expect(screen.getByRole('radio', { name: 'Against it' })).toBeChecked()
    // The walk is held at this door until the issues are answered.
    expect(onRecorded).not.toHaveBeenCalled()
  })

  it('advances once the canvasser confirms', async () => {
    const onRecorded = renderForm()
    await walkAndSave()

    fireEvent.click(await screen.findByRole('button', { name: 'Looks right' }))

    await waitFor(() =>
      expect(onRecorded).toHaveBeenCalledWith('person-1', 'needs_follow_up'),
    )
  })

  // The turf's "What we heard" counts are read once and kept for minutes, so
  // the knock, its note and its confirm each have to say they moved.
  it('re-reads the report when the knock saves and again when it is confirmed', async () => {
    const key = reportQueryKey(7)
    testQueryClient.setQueryData(key, { denominators: {} })
    const isInvalidated = () =>
      testQueryClient.getQueryState(key)?.isInvalidated

    const onRecorded = renderForm()
    await walkAndSave()
    await screen.findByRole('button', { name: 'Looks right' })
    expect(isInvalidated()).toBe(true)

    testQueryClient.setQueryData(key, { denominators: {} })
    expect(isInvalidated()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Looks right' }))

    await waitFor(() => expect(onRecorded).toHaveBeenCalled())
    expect(isInvalidated()).toBe(true)
  })

  // The knock behind a confirm card is saved, so leaving the card for a
  // housemate keeps nothing, and coming back offers a fresh door.
  it('never restores a confirm card or the answers behind it', async () => {
    const { store, drafts } = draftStore()
    const view = render(formWithDrafts(drafts))
    await walkAndSave()
    await screen.findByText('Is this right?')

    view.unmount()
    expect(store.has('21')).toBe(false)

    render(formWithDrafts(drafts))
    expect(screen.queryByText('Is this right?')).toBeNull()
    expect(
      question('Did they answer?').getByRole('radio', { name: 'Answered' }),
    ).toHaveAttribute('data-state', 'off')
  })

  // A transcript can arrive after Save. It is not a new, unsaved answer.
  it('keeps nothing for a saved door when dictation lands late', async () => {
    const { store, drafts } = draftStore()
    const onRecorded = vi.fn()
    const view = render(formWithDrafts(drafts, onRecorded))
    answer('Did they answer?', 'Not home')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onRecorded).toHaveBeenCalled())

    dictate('and a sentence the socket was still sending')
    view.unmount()

    expect(store.has('21')).toBe(false)
  })

  it('advances on skip, leaving the memo unconfirmed', async () => {
    const onRecorded = renderForm()
    await walkAndSave()

    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))

    await waitFor(() =>
      expect(onRecorded).toHaveBeenCalledWith('person-1', 'needs_follow_up'),
    )
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.IssueCapture.MemoSkipped, {
      channel: 'doorKnocking',
      product: 'serve',
    })
  })

  // The knock has already saved by the time capture runs. Holding a canvasser
  // at a logged door because a second request failed is the worse outcome, so
  // a capture failure advances the walk rather than trapping it.
  it('advances anyway when capture fails', async () => {
    api.mock('POST /v1/constituent-feedback', {
      status: 500,
      data: { message: 'boom' },
    })
    const onRecorded = renderForm()
    await walkAndSave()

    await waitFor(() =>
      expect(onRecorded).toHaveBeenCalledWith('person-1', 'needs_follow_up'),
    )
    expect(screen.queryByText('Is this right?')).toBeNull()
  })

  // Nothing about a constituent's words reaches analytics — only whether the
  // canvasser had to change what the model proposed.
  it('reports whether the proposal was corrected, never what it said', async () => {
    renderForm()
    await walkAndSave()

    const issue = await screen.findByDisplayValue('Flock cameras')
    fireEvent.change(issue, { target: { value: 'Surveillance cameras' } })
    fireEvent.click(screen.getByRole('button', { name: 'Looks right' }))

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.IssueCapture.MemoConfirmed,
        {
          channel: 'doorKnocking',
          corrected: true,
          issueCount: 1,
          product: 'serve',
        },
      ),
    )
  })

  // A canvass run only to gather issues often hears two or three in one
  // conversation, and the canvasser answers for each: keeping, correcting
  // or removing it.
  it('offers each issue the note named and confirms the ones kept', async () => {
    api.mock('POST /v1/constituent-feedback', {
      status: 200,
      data: {
        id: 'feedback-1',
        personId: 'person-1',
        extractionStatus: 'extracted',
        extraction: {
          issues: [
            FLOCK,
            {
              id: 'issue-street-flooding',
              position: 1,
              issueLabel: 'Street flooding',
              stance: 'supports',
              desiredOutcome: 'Clear the storm drain',
            },
          ],
        },
      },
    })
    let confirmed: unknown = null
    api.mock('PATCH /v1/constituent-feedback/:id/confirm', ({ body }) => {
      confirmed = body
      return {
        status: 200,
        data: {
          id: 'feedback-1',
          personId: 'person-1',
          occurredAt: new Date('2026-09-25T00:00:00.000Z'),
          channel: 'door_knock',
          transcript: MEMO,
          issues: [],
          extractionStatus: 'extracted',
          confirmedAt: new Date('2026-09-25T00:00:01.000Z'),
          outreachId: 7,
          actorName: null,
          tags: [],
        },
      }
    })
    renderForm()
    await walkAndSave()

    expect(await screen.findByDisplayValue('Flock cameras')).toBeVisible()
    expect(screen.getByDisplayValue('Street flooding')).toBeVisible()
    expect(screen.getByDisplayValue('Clear the storm drain')).toBeVisible()

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Flock cameras' }),
    )
    expect(screen.queryByDisplayValue('Flock cameras')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Looks right' }))

    await waitFor(() =>
      expect(confirmed).toEqual({
        issues: [
          {
            issueLabel: 'Street flooding',
            stance: 'supports',
            desiredOutcome: 'Clear the storm drain',
            fromIssueId: 'issue-street-flooding',
          },
        ],
      }),
    )
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.IssueCapture.MemoConfirmed, {
      channel: 'doorKnocking',
      corrected: true,
      issueCount: 1,
      product: 'serve',
    })
  })

  // A note that named no issue has nothing to fill in, and confirming it
  // says so.
  it('confirms a note that named no issue', async () => {
    api.mock('POST /v1/constituent-feedback', {
      status: 200,
      data: {
        id: 'feedback-1',
        personId: 'person-1',
        extractionStatus: 'extracted',
        extraction: { issues: [] },
      },
    })
    let confirmed: unknown = null
    api.mock('PATCH /v1/constituent-feedback/:id/confirm', ({ body }) => {
      confirmed = body
      return { status: 500, data: { message: 'boom' } }
    })
    renderForm()
    await walkAndSave()

    expect(
      await screen.findByText('No issue came up in this note.'),
    ).toBeVisible()
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Looks right' }))

    await waitFor(() => expect(confirmed).toEqual({ issues: [] }))
  })

  // The note field is deliberately offered on every branch, including a
  // not-home door, so a note there is real and worth keeping — but it is not
  // a constituent's position and must not be extracted as one.
  it('saves a not-home note without capturing an issue from it', async () => {
    const onRecorded = renderForm()
    answer('Did they answer?', 'Not home')
    dictate('Dog in the yard, come back Saturday.')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(onRecorded).toHaveBeenCalledWith('person-1', 'needs_follow_up'),
    )
    expect(screen.queryByText('Is this right?')).toBeNull()
  })

  // react-query refreshes a mutation's callbacks every render, so `onSuccess`
  // runs against the latest closure — and the engagement pills stay live while
  // the knock is in flight. Re-tapping one must not retroactively decide the
  // memo already dictated should be thrown away.
  it('still captures when the engagement is re-tapped mid-save', async () => {
    // A deferred the mock awaits, so the knock is genuinely in flight when the
    // pill is tapped. Held in an object: a null-initialised local narrows to
    // `never` across the await.
    const gate: { release: () => void } = { release: () => undefined }
    const inFlight = new Promise<void>((resolve) => {
      gate.release = resolve
    })
    let knockStarted = false
    api.mock('POST /v1/door-knocking/interactions', async () => {
      knockStarted = true
      await inFlight
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'needs_follow_up' },
      }
    })

    renderForm()
    await walkAndSave()
    await waitFor(() => expect(knockStarted).toBe(true))

    answer('Did they engage?', 'Refused')
    gate.release()

    expect(await screen.findByText('Is this right?')).toBeVisible()
  })

  // The placeholder promises an extraction, so it may only appear where one
  // actually happens. This field renders on the Win surface too.
  it('asks for issues and positions only where capture can fire', async () => {
    renderForm()
    answer('Did they answer?', 'Answered')
    answer('Did they engage?', 'Engaged')
    answer('Do they need follow-up?', 'Yes')

    expect(screen.getByPlaceholderText(/issues and positions/i)).toBeVisible()
  })

  // A not-home door still takes a note, but capture never fires there, so the
  // field must not promise one.
  it('keeps the plain note prompt where capture cannot fire', async () => {
    renderForm()
    answer('Did they answer?', 'Not home')

    expect(screen.getByPlaceholderText(/We'll clean it up/i)).toBeVisible()
    expect(screen.queryByPlaceholderText(/issues and positions/i)).toBeNull()
  })

  it('does not capture when the flag is off', async () => {
    setFlag(false)
    const onRecorded = renderForm()
    await walkAndSave()

    await waitFor(() =>
      expect(onRecorded).toHaveBeenCalledWith('person-1', 'needs_follow_up'),
    )
    expect(screen.queryByText('Is this right?')).toBeNull()
  })

  it('reports the memo as a Serve one', async () => {
    renderForm()
    await walkAndSave()

    await screen.findByText('Is this right?')
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.IssueCapture.MemoRecorded, {
      channel: 'doorKnocking',
      captureMethod: 'dictation',
      extractionStatus: 'extracted',
      product: 'serve',
    })
  })
})

// A candidate's door, where the memo is what a voter told the canvasser. Same
// form, same sequencing, same flag.
// A dead zone: the knock and its memo wait on the phone, knock first, and
// the walk moves on as it would online. Nobody can confirm issues that
// have not been extracted yet, so there is no card to hold the door for.
describe('RecordKnockForm issue capture with no signal', () => {
  let online = false

  beforeEach(() => {
    installIndexedDbShim()
    online = false
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => online,
    })
    mocks.successSnackbar.mockClear()
  })

  afterEach(() => {
    online = true
  })

  it('holds the knock and the memo on the phone and walks on', async () => {
    const knocks = vi.fn()
    api.mock('POST /v1/door-knocking/interactions', () => {
      knocks()
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'needs_follow_up' },
      }
    })
    const onRecorded = renderForm()
    await walkAndSave()

    await waitFor(() =>
      expect(onRecorded).toHaveBeenCalledWith('person-1', 'needs_follow_up'),
    )
    expect(mocks.successSnackbar).toHaveBeenCalledWith(
      'Saved on your device. It will be sent when you have signal.',
    )
    expect(knocks).not.toHaveBeenCalled()
    expect(screen.queryByText('Is this right?')).toBeNull()

    const queued = await listQueue()
    const knock = queued.find((entry) => entry.kind === 'knock')
    const memo = queued.find((entry) => entry.kind === 'memo')
    expect(knock?.payload).toEqual({
      stopTargetId: 21,
      clientKey: '6f1d7a9c-3f1e-4f0a-9f4e-2f5a6b7c8d90',
      outcome: 'answered',
      followUp: 'yes',
      note: MEMO,
    })
    expect(memo?.payload).toEqual({
      reference: {
        channel: 'door_knock',
        knockClientKey: '6f1d7a9c-3f1e-4f0a-9f4e-2f5a6b7c8d90',
        stopTargetId: 21,
        clientKey: '6f1d7a9c-3f1e-4f0a-9f4e-2f5a6b7c8d90',
      },
      text: { transcript: MEMO, captureMethod: 'dictation' },
      analytics: { channel: 'doorKnocking', product: 'serve' },
    })
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.IssueCapture.MemoQueuedOffline,
      { channel: 'doorKnocking', product: 'serve' },
    )
    // Logged on the phone is logged: the door counts now, not on upload.
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.DoorKnocking.DoorLogged,
      expect.objectContaining({
        outcome: 'answered',
        knockStatus: 'needs_follow_up',
      }),
    )
  })

  // A not-home door has no conversation to capture, so only the knock waits.
  it('holds a knock with no conversation on its own', async () => {
    const onRecorded = renderForm()
    answer('Did they answer?', 'Not home')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(onRecorded).toHaveBeenCalledWith('person-1', 'not_home'),
    )
    expect((await listQueue()).map((entry) => entry.kind)).toEqual(['knock'])
  })
})

// The edges of the offline path: where it must not fire, where it must
// fire although the browser thinks it is online, and how a second save of
// the same door treats what the phone still holds.
describe('RecordKnockForm offline edges', () => {
  let online = true
  const KEY = '6f1d7a9c-3f1e-4f0a-9f4e-2f5a6b7c8d90'

  class FakeMediaRecorder {
    state: 'inactive' | 'recording' = 'inactive'
    mimeType = 'audio/webm;codecs=opus'
    ondataavailable: ((event: { data: Blob }) => void) | null = null
    onstop: (() => void) | null = null
    start() {
      this.state = 'recording'
    }
    stop() {
      this.state = 'inactive'
      this.ondataavailable?.({
        data: new Blob(['what they said'], { type: this.mimeType }),
      })
      this.onstop?.()
    }
  }

  beforeEach(() => {
    installIndexedDbShim()
    online = true
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => online,
    })
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: vi.fn() }],
        })),
      },
    })
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    mocks.successSnackbar.mockClear()
  })

  afterEach(() => {
    online = true
  })

  // Held on the device is saved: the answers that were restored into the
  // form go with the hold.
  it('drops the answers it restored once the door is held', async () => {
    const { store, drafts } = draftStore()
    store.set('21', {
      outcome: 'not_home',
      note: 'Dog in the yard',
      spoken: false,
    })
    const onRecorded = vi.fn()
    const view = render(formWithDrafts(drafts, onRecorded))
    expect(
      question('Did they answer?').getByRole('radio', { name: 'Not home' }),
    ).toHaveAttribute('data-state', 'on')

    online = false
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onRecorded).toHaveBeenCalled())
    view.unmount()

    expect(await listQueue()).toEqual([
      expect.objectContaining({ kind: 'knock' }),
    ])
    expect(store.has('21')).toBe(false)
  })

  // The flag is the rollback lever: with it off, nothing is held.
  it('holds nothing with capture off, even offline', async () => {
    setFlag(false)
    online = false
    const knocks = vi.fn()
    api.mock('POST /v1/door-knocking/interactions', () => {
      knocks()
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'needs_follow_up' },
      }
    })
    renderForm()
    await walkAndSave()

    await waitFor(() => expect(knocks).toHaveBeenCalled())
    expect(await listQueue()).toEqual([])
  })

  // With the flag off the form is exactly what it was: an online save
  // walks on without waiting on the phone's storage.
  it('leaves the queue alone on an online save with capture off', async () => {
    setFlag(false)
    vi.mocked(enqueue).mockClear()
    vi.mocked(removeFromQueue).mockClear()
    const onRecorded = renderForm()
    await walkAndSave()

    await waitFor(() => expect(onRecorded).toHaveBeenCalled())
    expect(removeFromQueue).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  // The browser said online, but the request never got an answer.
  it('holds a knock whose request got no answer, and walks on', async () => {
    mswServer.use(
      http.post('*/v1/door-knocking/interactions', () => HttpResponse.error()),
    )
    const onRecorded = renderForm()
    await walkAndSave()

    await waitFor(() =>
      expect(onRecorded).toHaveBeenCalledWith('person-1', 'needs_follow_up'),
    )
    expect((await listQueue()).map((entry) => entry.id).sort()).toEqual([
      'knock:21',
      'memo:21',
    ])
    expect(
      screen.queryByText(
        'Saving failed — your answers are still here, try again.',
      ),
    ).toBeNull()
  })

  it('replaces what it holds for a door saved again offline', async () => {
    online = false
    await enqueue([
      {
        id: 'knock:21',
        kind: 'knock',
        organizationSlug: '',
        payload: { stopTargetId: 21, clientKey: KEY, outcome: 'not_home' },
        createdAt: 1,
      },
    ])
    const onRecorded = renderForm()
    await walkAndSave()

    await waitFor(() => expect(onRecorded).toHaveBeenCalled())
    const knocks = (await listQueue()).filter((entry) => entry.kind === 'knock')
    expect(knocks).toHaveLength(1)
    expect(knocks[0]?.payload).toEqual(
      expect.objectContaining({ outcome: 'answered', followUp: 'yes' }),
    )
  })

  // A save that reached the server supersedes the older one still queued,
  // which would otherwise land later and read as the newer.
  it('drops what it held for a door saved again online', async () => {
    await enqueue([
      {
        id: 'knock:21',
        kind: 'knock',
        organizationSlug: 'someone-else',
        payload: { stopTargetId: 21, clientKey: KEY, outcome: 'not_home' },
        createdAt: 1,
      },
    ])
    const onRecorded = renderForm()
    answer('Did they answer?', 'Not home')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onRecorded).toHaveBeenCalled())
    await waitFor(async () => expect(await listQueue()).toEqual([]))
  })

  it('records a conversation on the phone with no signal and holds it', async () => {
    online = false
    const onRecorded = renderForm()
    answer('Did they answer?', 'Answered')
    answer('Did they engage?', 'Engaged')
    answer('Do they need follow-up?', 'Yes')

    fireEvent.click(screen.getByRole('button', { name: 'Dictate note' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Stop dictation' }),
    )
    expect(
      await screen.findByText('Note recorded on your device.'),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onRecorded).toHaveBeenCalled())
    const memo = (await listQueue()).find((entry) => entry.kind === 'memo')
    expect(memo?.kind === 'memo' && memo.blob).toBeInstanceOf(Blob)
  })

  it('says the note is being sent when a recording follows a saved knock', async () => {
    online = false
    const onRecorded = renderForm()
    answer('Did they answer?', 'Answered')
    answer('Did they engage?', 'Engaged')
    answer('Do they need follow-up?', 'Yes')

    fireEvent.click(screen.getByRole('button', { name: 'Dictate note' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Stop dictation' }),
    )
    await screen.findByText('Note recorded on your device.')
    online = true
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onRecorded).toHaveBeenCalled())
    expect(mocks.successSnackbar).toHaveBeenCalledWith(
      'Note saved on your device. Sending it now.',
    )
  })

  // A door that did not engage has no conversation to capture, so the mic
  // stays the ordinary dictation mic and nothing records on the phone.
  it('never records on the phone at a door that did not engage', async () => {
    online = false
    renderForm()
    answer('Did they answer?', 'Not home')

    fireEvent.click(screen.getByRole('button', { name: 'Dictate note' }))

    // The live dictation it wraps, which fails the ordinary way offline.
    expect(mocks.start).toHaveBeenCalled()
    expect(screen.queryByText('Note recorded on your device.')).toBeNull()
  })
})

describe('RecordKnockForm issue capture on a Win door', () => {
  const walkWinAndSave = () => {
    answer('Did they answer?', 'Answered')
    answer('Did they engage?', 'Engaged')
    answer('Do they support you?', 'Yes')
    answer('Will they vote this election?', 'Yes')
    dictate(MEMO)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  }

  beforeEach(() => {
    setFlag(true)
    api.mock('POST /v1/door-knocking/interactions', {
      status: 200,
      data: { personId: 'person-1', knockStatus: 'supporter' },
    })
  })

  it('captures and confirms on a Win door', async () => {
    const onRecorded = renderForm(vi.fn(), false)
    walkWinAndSave()

    expect(await screen.findByText('Is this right?')).toBeVisible()
    expect(onRecorded).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Looks right' }))

    await waitFor(() =>
      expect(onRecorded).toHaveBeenCalledWith('person-1', 'supporter'),
    )
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.IssueCapture.MemoConfirmed, {
      channel: 'doorKnocking',
      corrected: false,
      issueCount: 1,
      product: 'win',
    })
  })

  it('does not capture on a Win door when the flag is off', async () => {
    setFlag(false)
    const onRecorded = renderForm(vi.fn(), false)
    walkWinAndSave()

    await waitFor(() =>
      expect(onRecorded).toHaveBeenCalledWith('person-1', 'supporter'),
    )
    expect(screen.queryByText('Is this right?')).toBeNull()
  })

  it('asks what they told you, in Win’s words', () => {
    renderForm(vi.fn(), false)
    answer('Did they answer?', 'Answered')
    answer('Did they engage?', 'Engaged')
    answer('Do they support you?', 'Yes')
    answer('Will they vote this election?', 'Yes')

    expect(screen.getByPlaceholderText('What did they tell you?')).toBeVisible()
    expect(document.body.textContent ?? '').not.toMatch(/constituent/i)
  })

  it('never says constituent on the confirm card', async () => {
    renderForm(vi.fn(), false)
    walkWinAndSave()

    await screen.findByText('Is this right?')
    expect(document.body.textContent ?? '').not.toMatch(/constituent/i)
  })

  it('reports the skip as a Win one', async () => {
    renderForm(vi.fn(), false)
    walkWinAndSave()

    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))

    expect(trackEvent).toHaveBeenCalledWith(EVENTS.IssueCapture.MemoSkipped, {
      channel: 'doorKnocking',
      product: 'win',
    })
  })
})
