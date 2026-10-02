import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import { installIndexedDbShim } from 'helpers/test-utils/indexedDbShim'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { UseDictationAppendResult } from './useDictationAppend'
import type { DictationStatus } from './useDictation'
import { listQueue } from './offlineMemoQueue'
import { useOfflineMemo } from './useOfflineMemo'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

// MediaRecorder is not in jsdom. This one hands back one chunk on stop, the
// way a short recording does.
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
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
      data: new Blob(['what they said'], { type: this.mimeType }),
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
    const { result } = renderHook(() => useOfflineMemo({ dictation }))

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
    const { result } = renderHook(() => useOfflineMemo({ dictation }))
    await act(() => result.current.mic.toggle())
    await act(() => result.current.mic.toggle())
    expect(result.current.audio).not.toBeNull()

    act(() => result.current.discard())

    expect(result.current.audio).toBeNull()
  })

  it('dictates live when there is signal', async () => {
    const dictation = fakeDictation()
    const { result } = renderHook(() => useOfflineMemo({ dictation }))

    await act(() => result.current.mic.toggle())

    expect(dictation.start).toHaveBeenCalled()
    expect(FakeMediaRecorder.instances).toHaveLength(0)
  })

  // Signal that cannot hold a socket open is no signal for dictation.
  it('records on the phone when the socket does not open in 3 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const idle = fakeDictation()
    const { result, rerender } = renderHook(
      ({ dictation }) => useOfflineMemo({ dictation }),
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
      ({ dictation }) => useOfflineMemo({ dictation }),
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
      sent.push(`upload-url:${body.clientKey}`)
      return {
        status: 200,
        data: {
          audioKey: AUDIO_KEY,
          uploadUrl: UPLOAD_URL,
          expiresAt: new Date(),
        },
      }
    })
    mswServer.use(
      http.put(UPLOAD_URL, async ({ request }) => {
        sent.push(`put:${(await request.blob()).size}`)
        return new HttpResponse(null, { status: 200 })
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
    const { result } = renderHook(() => useOfflineMemo({ dictation }))
    await act(() => result.current.mic.toggle())
    await act(() => result.current.mic.toggle())
    await act(() =>
      result.current.hold({
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
      `upload-url:${KNOCK_KEY}`,
      `put:${'what they said'.length}`,
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
