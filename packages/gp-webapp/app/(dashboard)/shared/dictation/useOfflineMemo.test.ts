import {
  act,
  renderHook as renderHookBare,
  waitFor,
} from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { http, HttpResponse } from 'msw'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import { installIndexedDbShim } from 'helpers/test-utils/indexedDbShim'
import { testQueryClient } from 'helpers/test-utils/render'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { reportErrorToSentry } from '@shared/sentry'
import type { UseDictationAppendResult } from './useDictationAppend'
import type { DictationStatus } from './useDictation'
import { enqueue, listQueue, type QueueEntry } from './offlineMemoQueue'
import { useOfflineMemo, useOfflineQueueDrain } from './useOfflineMemo'
import { reportQueryKey } from 'app/(dashboard)/issue-capture/[outreachId]/queries'

vi.mock('@shared/sentry', () => ({ reportErrorToSentry: vi.fn() }))

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

// The hook re-reads the review lists after a drain, so it needs a client.
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: testQueryClient }, children)

const renderHook: typeof renderHookBare = (render, options) =>
  renderHookBare(render, { wrapper, ...options })

// MediaRecorder is not in jsdom. This one hands back one chunk on stop, the
// way a short recording does.
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  // A tap-tap on iOS Safari stops before any audio arrives.
  static silent = false
  state: 'inactive' | 'recording' = 'inactive'
  mimeType = 'audio/webm;codecs=opus'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null

  constructor() {
    FakeMediaRecorder.instances.push(this)
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({
      data: new Blob(FakeMediaRecorder.silent ? [] : ['what they said'], {
        type: this.mimeType,
      }),
    })
    this.onstop?.()
  }
}

let online = true
const getUserMedia = vi.fn()

const fakeDictation = (
  status: DictationStatus = 'idle',
): UseDictationAppendResult => ({
  status,
  error: null,
  partialTranscript: '',
  active: status !== 'idle' && status !== 'error',
  busy: status === 'requesting_mic' || status === 'connecting',
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  toggle: vi.fn(async () => undefined),
})

const KNOCK_KEY = '6f1d7a9c-3f1e-4f0a-9f4e-2f5a6b7c8d90'
const AUDIO_KEY = `constituent-feedback/campaign-1/${KNOCK_KEY}.webm`
const UPLOAD_URL = 'https://uploads.test/memo'

beforeEach(() => {
  installIndexedDbShim()
  online = true
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  })
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] })
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })
  FakeMediaRecorder.instances = []
  FakeMediaRecorder.silent = false
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  document.cookie = 'organization-slug=campaign-1'
  vi.mocked(trackEvent).mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useOfflineMemo', () => {
  it('records on the phone when there is no signal', async () => {
    online = false
    const dictation = fakeDictation()
    const { result } = renderHook(() =>
      useOfflineMemo({ dictation, enabled: true }),
    )

    await act(() => result.current.mic.toggle())
    expect(dictation.start).not.toHaveBeenCalled()
    expect(FakeMediaRecorder.instances).toHaveLength(1)
    expect(result.current.mic.status).toBe('recording')

    await act(() => result.current.mic.toggle())
    expect(result.current.audio).toBeInstanceOf(Blob)
    expect(result.current.mic.status).toBe('idle')
  })

  // Cancel on the form throws the recording away with the answers.
  it('drops a recording on discard', async () => {
    online = false
    const dictation = fakeDictation()
    const { result } = renderHook(() =>
      useOfflineMemo({ dictation, enabled: true }),
    )
    await act(() => result.current.mic.toggle())
    await act(() => result.current.mic.toggle())
    expect(result.current.audio).not.toBeNull()

    act(() => result.current.discard())

    expect(result.current.audio).toBeNull()
  })

  it('dictates live when there is signal', async () => {
    const dictation = fakeDictation()
    const { result } = renderHook(() =>
      useOfflineMemo({ dictation, enabled: true }),
    )

    await act(() => result.current.mic.toggle())

    expect(dictation.start).toHaveBeenCalled()
    expect(FakeMediaRecorder.instances).toHaveLength(0)
  })

  // Signal that cannot hold a socket open is no signal for dictation.
  it('records on the phone when the socket does not open in 3 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const idle = fakeDictation()
    const { result, rerender } = renderHook(
      ({ dictation }) => useOfflineMemo({ dictation, enabled: true }),
      { initialProps: { dictation: idle } },
    )
    await act(() => result.current.mic.toggle())
    const connecting = fakeDictation('connecting')
    rerender({ dictation: connecting })

    await act(() => vi.advanceTimersByTimeAsync(2_999))
    expect(FakeMediaRecorder.instances).toHaveLength(0)

    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(connecting.stop).toHaveBeenCalled()
    expect(FakeMediaRecorder.instances).toHaveLength(1)
  })

  it('records on the phone at once when the dictation session fails', async () => {
    const { result, rerender } = renderHook(
      ({ dictation }) => useOfflineMemo({ dictation, enabled: true }),
      { initialProps: { dictation: fakeDictation() } },
    )
    await act(() => result.current.mic.toggle())
    rerender({ dictation: fakeDictation('connecting') })
    rerender({ dictation: { ...fakeDictation('error'), error: 'Failed' } })

    await waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(1))
    // The phone is recording, so the failed session is not the news.
    expect(result.current.mic.error).toBeNull()
  })

  it('sends the knock, then uploads the memo, once signal returns', async () => {
    online = false
    const sent: string[] = []
    let memoBody: unknown = null
    api.mock('POST /v1/door-knocking/interactions', () => {
      sent.push('knock')
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'engaged' },
      }
    })
    api.mock('POST /v1/constituent-feedback/audio-upload-url', ({ body }) => {
      sent.push(`upload-url:${body.clientKey}:${body.contentType}`)
      return {
        status: 200,
        data: {
          audioKey: AUDIO_KEY,
          uploadUrl: UPLOAD_URL,
          fields: { key: AUDIO_KEY, Policy: 'signed' },
          expiresAt: new Date(),
        },
      }
    })
    mswServer.use(
      http.post(UPLOAD_URL, async ({ request }) => {
        const form = await request.formData()
        const file = form.get('file')
        const size = file === null || typeof file === 'string' ? 0 : file.size
        sent.push(`post:${String(form.get('Policy'))}:${size}`)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    api.mock('POST /v1/constituent-feedback', ({ body }) => {
      sent.push('memo')
      memoBody = body
      return {
        status: 200,
        data: {
          id: 'feedback-1',
          personId: 'person-1',
          extractionStatus: 'pending',
          extraction: null,
        },
      }
    })

    const dictation = fakeDictation()
    const { result } = renderHook(() =>
      useOfflineMemo({ dictation, enabled: true }),
    )
    await act(() => result.current.mic.toggle())
    await act(() => result.current.mic.toggle())
    await act(() =>
      result.current.hold({
        key: '21',
        interaction: {
          kind: 'knock',
          payload: {
            stopTargetId: 21,
            clientKey: KNOCK_KEY,
            outcome: 'answered',
            followUp: 'no',
          },
        },
        memo: {
          reference: {
            channel: 'door_knock',
            knockClientKey: KNOCK_KEY,
            stopTargetId: 21,
            clientKey: KNOCK_KEY,
          },
          analytics: { channel: 'doorKnocking', product: 'serve' },
        },
      }),
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.IssueCapture.MemoQueuedOffline,
      { channel: 'doorKnocking', product: 'serve' },
    )
    expect(result.current.audio).toBeNull()
    expect(sent).toEqual([])

    online = true
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })

    await waitFor(() => expect(sent).toHaveLength(4))
    expect(sent).toEqual([
      'knock',
      `upload-url:${KNOCK_KEY}:audio/webm;codecs=opus`,
      `post:signed:${'what they said'.length}`,
      'memo',
    ])
    expect(memoBody).toEqual({
      channel: 'door_knock',
      knockClientKey: KNOCK_KEY,
      stopTargetId: 21,
      clientKey: KNOCK_KEY,
      audioKey: AUDIO_KEY,
      captureMethod: 'dictation_offline',
    })
    await waitFor(async () => expect(await listQueue()).toEqual([]))
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.IssueCapture.MemoUploaded,
      expect.objectContaining({
        channel: 'doorKnocking',
        product: 'serve',
        queuedForMs: expect.any(Number),
      }),
    )
  })
})

// The page-level drain: a canvasser who closed the door's form and walked on
// still sends everything the moment signal returns.
describe('useOfflineQueueDrain', () => {
  it('sends a queued memo when signal returns with no form open', async () => {
    online = false
    const posted: unknown[] = []
    api.mock('POST /v1/constituent-feedback', ({ body }) => {
      posted.push(body)
      return {
        status: 200,
        data: {
          id: 'feedback-1',
          personId: 'person-1',
          extractionStatus: 'extracted',
          extraction: null,
        },
      }
    })
    await enqueue([
      {
        id: `memo:${KNOCK_KEY}`,
        kind: 'memo',
        organizationSlug: 'campaign-1',
        payload: {
          reference: {
            channel: 'door_knock',
            knockClientKey: KNOCK_KEY,
            stopTargetId: 21,
            clientKey: KNOCK_KEY,
          },
          text: {
            transcript: 'She wants the drain cleared.',
            captureMethod: 'typed',
          },
          analytics: { channel: 'doorKnocking', product: 'win' },
        },
        createdAt: Date.now(),
      },
    ])
    renderHook(() => useOfflineQueueDrain())
    expect(posted).toEqual([])

    online = true
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })

    await waitFor(() => expect(posted).toHaveLength(1))
    await waitFor(async () => expect(await listQueue()).toEqual([]))
  })

  // The phone caller re-reads its list from here, so a held call shows
  // what the server recorded once it lands.
  it('tells the page once something was sent', async () => {
    api.mock('POST /v1/door-knocking/interactions', {
      status: 200,
      data: { personId: 'person-1', knockStatus: 'not_home' },
    })
    await enqueue([
      {
        id: 'knock:21',
        kind: 'knock',
        organizationSlug: 'campaign-1',
        payload: {
          stopTargetId: 21,
          clientKey: KNOCK_KEY,
          outcome: 'not_home',
        },
        createdAt: Date.now(),
      },
    ])
    const onSent = vi.fn()

    renderHook(() => useOfflineQueueDrain({ onSent }))

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1))
  })

  // "What we heard" reads its counts once, so a knock that arrives from the
  // queue has to say so as plainly as one saved online.
  it('re-reads every effort’s report once something was sent', async () => {
    api.mock('POST /v1/door-knocking/interactions', {
      status: 200,
      data: { personId: 'person-1', knockStatus: 'not_home' },
    })
    await enqueue([
      {
        id: 'knock:21',
        kind: 'knock',
        organizationSlug: 'campaign-1',
        payload: {
          stopTargetId: 21,
          clientKey: KNOCK_KEY,
          outcome: 'not_home',
        },
        createdAt: Date.now(),
      },
    ])
    testQueryClient.setQueryData(reportQueryKey(7), { denominators: {} })
    const onSent = vi.fn()

    renderHook(() => useOfflineQueueDrain({ onSent }))

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1))
    expect(
      testQueryClient.getQueryState(reportQueryKey(7))?.isInvalidated,
    ).toBe(true)
  })
})

describe('useOfflineMemo where no memo can be captured', () => {
  // The flag is off, or the door did not engage: the mic is the ordinary
  // dictation mic, and the phone records nothing it could not send.
  it('dictates instead of recording on the phone, even offline', async () => {
    online = false
    const dictation = fakeDictation()
    const { result } = renderHook(() =>
      useOfflineMemo({ dictation, enabled: false }),
    )

    await act(() => result.current.mic.toggle())

    expect(dictation.start).toHaveBeenCalled()
    expect(FakeMediaRecorder.instances).toHaveLength(0)
  })

  it('never falls back to the phone when the socket stalls', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { rerender, result } = renderHook(
      ({ dictation }) => useOfflineMemo({ dictation, enabled: false }),
      { initialProps: { dictation: fakeDictation() } },
    )
    rerender({ dictation: fakeDictation('connecting') })

    await act(() => vi.advanceTimersByTimeAsync(3_000))

    expect(FakeMediaRecorder.instances).toHaveLength(0)
    expect(result.current.fellBack).toBe(false)
  })

  // The door turned out not to engage after all: the recording goes.
  it('drops a recording when the memo stops being capturable', async () => {
    online = false
    const dictation = fakeDictation()
    const { result, rerender } = renderHook(
      ({ enabled }) => useOfflineMemo({ dictation, enabled }),
      { initialProps: { enabled: true } },
    )
    await act(() => result.current.mic.toggle())
    await act(() => result.current.mic.toggle())
    expect(result.current.audio).not.toBeNull()

    rerender({ enabled: false })

    expect(result.current.audio).toBeNull()
  })
})

describe('useOfflineMemo fallback', () => {
  it('says the socket fell back, so the save can be held too', async () => {
    const { result, rerender } = renderHook(
      ({ dictation }) => useOfflineMemo({ dictation, enabled: true }),
      { initialProps: { dictation: fakeDictation() } },
    )
    expect(result.current.fellBack).toBe(false)
    await act(() => result.current.mic.toggle())
    rerender({ dictation: fakeDictation('connecting') })
    rerender({ dictation: { ...fakeDictation('error'), error: 'Failed' } })

    await waitFor(() => expect(result.current.fellBack).toBe(true))
  })
})

// What the drain keeps and what it drops. Only a 400, 404, 409 or 422 with a
// reason in the body is a refusal; a 401 is what a request looks like in the
// moment after reconnecting, before the session token refreshes.
describe('the drain’s sender', () => {
  const queueKnock = () =>
    enqueue([
      {
        id: 'knock:21',
        kind: 'knock',
        organizationSlug: 'campaign-1',
        payload: {
          stopTargetId: 21,
          clientKey: KNOCK_KEY,
          outcome: 'not_home',
        },
        createdAt: Date.now(),
      },
    ])

  const drainNow = async () => {
    renderHook(() => useOfflineQueueDrain())
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
  }

  it('keeps an entry through a 401 and sends it on the next drain', async () => {
    await queueKnock()
    let attempts = 0
    api.mockOrdered('POST /v1/door-knocking/interactions', [
      { status: 401, data: { message: 'Unauthorized' } },
      { status: 200, data: { personId: 'person-1', knockStatus: 'not_home' } },
    ])
    mswServer.events.on('request:start', ({ request }) => {
      if (request.url.endsWith('/door-knocking/interactions')) attempts += 1
    })
    onTestFinished(() => mswServer.events.removeAllListeners())

    await drainNow()
    await waitFor(() => expect(attempts).toBeGreaterThanOrEqual(1))
    await waitFor(async () =>
      expect((await listQueue()).map((entry) => entry.id)).toEqual([
        'knock:21',
      ]),
    )

    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(async () => expect(await listQueue()).toEqual([]))
    expect(attempts).toBe(2)
  })

  it('keeps an entry through a 5xx', async () => {
    await queueKnock()
    let attempts = 0
    api.mock('POST /v1/door-knocking/interactions', () => {
      attempts += 1
      return { status: 500, data: { message: 'boom' } }
    })

    await drainNow()

    await waitFor(() => expect(attempts).toBe(1))
    await waitFor(async () =>
      expect((await listQueue()).map((entry) => entry.id)).toEqual([
        'knock:21',
      ]),
    )
  })

  it('drops an entry the server refused with a reason', async () => {
    await queueKnock()
    api.mock('POST /v1/door-knocking/interactions', {
      status: 422,
      data: { message: 'Not a knock this turf can take' },
    })

    await drainNow()

    await waitFor(async () => expect(await listQueue()).toEqual([]))
  })

  // Text the canvasser kept is sent as the memo; the recording goes with
  // the entry once it lands, and nothing is uploaded.
  it('sends a memo’s words over its recording', async () => {
    const posted: unknown[] = []
    let uploads = 0
    api.mock('POST /v1/constituent-feedback/audio-upload-url', () => {
      uploads += 1
      return {
        status: 200,
        data: {
          audioKey: AUDIO_KEY,
          uploadUrl: UPLOAD_URL,
          fields: {},
          expiresAt: new Date(),
        },
      }
    })
    api.mock('POST /v1/constituent-feedback', ({ body }) => {
      posted.push(body)
      return {
        status: 200,
        data: {
          id: 'feedback-1',
          personId: 'person-1',
          extractionStatus: 'extracted',
          extraction: null,
        },
      }
    })
    await enqueue([
      {
        id: 'memo:21',
        kind: 'memo',
        organizationSlug: 'campaign-1',
        payload: {
          reference: {
            channel: 'door_knock',
            knockClientKey: KNOCK_KEY,
            stopTargetId: 21,
            clientKey: KNOCK_KEY,
          },
          text: {
            transcript: 'Wants the drain cleared.',
            captureMethod: 'typed',
          },
          analytics: { channel: 'doorKnocking', product: 'win' },
        },
        blob: new Blob(['sound'], { type: 'audio/webm' }),
        createdAt: Date.now(),
      },
    ])

    await drainNow()

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toEqual({
      channel: 'door_knock',
      knockClientKey: KNOCK_KEY,
      stopTargetId: 21,
      clientKey: KNOCK_KEY,
      transcript: 'Wants the drain cleared.',
      captureMethod: 'typed',
    })
    expect(uploads).toBe(0)
    await waitFor(async () => expect(await listQueue()).toEqual([]))
  })
})

// Entries that would fail the same way on every drain leave the queue, so
// they never hold up the memos behind them.
describe('entries that can never be sent', () => {
  const memoWithRecording = (blob: Blob): QueueEntry => ({
    id: 'memo:21',
    kind: 'memo',
    organizationSlug: 'campaign-1',
    payload: {
      reference: {
        channel: 'door_knock',
        knockClientKey: KNOCK_KEY,
        stopTargetId: 21,
        clientKey: KNOCK_KEY,
      },
      analytics: { channel: 'doorKnocking', product: 'win' },
    },
    blob,
    createdAt: Date.now(),
  })

  const drainNow = async () => {
    renderHook(() => useOfflineQueueDrain())
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
  }

  const mockUploadUrl = () => {
    let asked = 0
    api.mock('POST /v1/constituent-feedback/audio-upload-url', () => {
      asked += 1
      return {
        status: 200,
        data: {
          audioKey: AUDIO_KEY,
          uploadUrl: UPLOAD_URL,
          fields: {},
          expiresAt: new Date(),
        },
      }
    })
    return () => asked
  }

  // S3's policy refuses an empty file every time.
  it('never holds a recording with nothing in it', async () => {
    online = false
    FakeMediaRecorder.silent = true
    const { result } = renderHook(() =>
      useOfflineMemo({ dictation: fakeDictation(), enabled: true }),
    )

    await act(() => result.current.mic.toggle())
    await act(() => result.current.mic.toggle())

    expect(result.current.audio).toBeNull()
    expect(result.current.mic.status).toBe('idle')
  })

  it('drops an empty recording already queued, without uploading it', async () => {
    const asked = mockUploadUrl()
    await enqueue([memoWithRecording(new Blob([], { type: 'audio/webm' }))])

    await drainNow()

    await waitFor(async () => expect(await listQueue()).toEqual([]))
    expect(asked()).toBe(0)
  })

  // Knocks and calls are Pro-gated: a lapsed Pro is refused every time.
  it('drops an entry refused with a 403', async () => {
    await enqueue([
      {
        id: 'knock:21',
        kind: 'knock',
        organizationSlug: 'campaign-1',
        payload: {
          stopTargetId: 21,
          clientKey: KNOCK_KEY,
          outcome: 'not_home',
        },
        createdAt: Date.now(),
      },
    ])
    api.mock('POST /v1/door-knocking/interactions', {
      status: 403,
      data: { message: 'Forbidden' },
    })

    await drainNow()

    await waitFor(async () => expect(await listQueue()).toEqual([]))
  })

  it('drops a memo whose upload S3 refused, and reports why once', async () => {
    mockUploadUrl()
    mswServer.use(
      http.post(
        UPLOAD_URL,
        () =>
          new HttpResponse('<Error><Code>EntityTooLarge</Code></Error>', {
            status: 400,
          }),
      ),
    )
    await enqueue([
      memoWithRecording(new Blob(['sound'], { type: 'audio/webm' })),
    ])

    await drainNow()

    await waitFor(async () => expect(await listQueue()).toEqual([]))
    expect(reportErrorToSentry).toHaveBeenCalledTimes(1)
    expect(reportErrorToSentry).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        status: 400,
        body: '<Error><Code>EntityTooLarge</Code></Error>',
      }),
    )
  })

  it('keeps a memo whose upload got a 503', async () => {
    mockUploadUrl()
    let attempts = 0
    mswServer.use(
      http.post(UPLOAD_URL, () => {
        attempts += 1
        return new HttpResponse('Slow down', { status: 503 })
      }),
    )
    await enqueue([
      memoWithRecording(new Blob(['sound'], { type: 'audio/webm' })),
    ])

    await drainNow()

    await waitFor(() => expect(attempts).toBe(1))
    await waitFor(async () =>
      expect((await listQueue()).map((entry) => entry.id)).toEqual(['memo:21']),
    )
  })
})

describe('holding the same door again', () => {
  // A door saved with a memo, then saved again with none: the earlier memo
  // must not be sent against a knock that may now say nobody was home.
  it('drops the memo it held for a door re-saved without one', async () => {
    online = false
    const { result } = renderHook(() =>
      useOfflineMemo({ dictation: fakeDictation(), enabled: true }),
    )
    const knock = {
      kind: 'knock' as const,
      payload: {
        stopTargetId: 21,
        clientKey: KNOCK_KEY,
        outcome: 'answered' as const,
        followUp: 'no' as const,
      },
    }
    await act(() =>
      result.current.hold({
        key: '21',
        interaction: knock,
        memo: {
          reference: {
            channel: 'door_knock',
            knockClientKey: KNOCK_KEY,
            stopTargetId: 21,
            clientKey: KNOCK_KEY,
          },
          text: {
            transcript: 'Wants the drain cleared.',
            captureMethod: 'typed',
          },
          analytics: { channel: 'doorKnocking', product: 'win' },
        },
      }),
    )

    await act(() =>
      result.current.hold({
        key: '21',
        interaction: {
          kind: 'knock',
          payload: {
            stopTargetId: 21,
            clientKey: KNOCK_KEY,
            outcome: 'not_home',
          },
        },
        memo: null,
      }),
    )

    expect((await listQueue()).map((entry) => entry.id)).toEqual(['knock:21'])
  })
})

// A call held while the page is open goes at once from the form, and the
// caller page still has to hear about it to re-read its list.
describe('a drain the form starts', () => {
  it('reaches the page’s onSent', async () => {
    api.mock('POST /v1/phone-banking/lists/:id/calls', {
      status: 200,
      data: { entryId: 4021, results: [], envelopeCompleted: false },
    })
    const onSent = vi.fn()
    renderHook(() => useOfflineQueueDrain({ onSent }))
    const { result } = renderHook(() =>
      useOfflineMemo({ dictation: fakeDictation(), enabled: true }),
    )

    await act(() =>
      result.current.hold({
        key: '4021:person-1',
        interaction: {
          kind: 'call',
          payload: {
            listId: 9,
            request: { entryId: 4021, outcome: 'voicemail' },
          },
        },
        memo: null,
      }),
    )

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1))
  })
})
