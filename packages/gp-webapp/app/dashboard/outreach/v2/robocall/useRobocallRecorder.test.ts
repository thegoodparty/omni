import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  RECORDING_UNUSABLE_MESSAGE,
  useRobocallRecorder,
} from './useRobocallRecorder'

// The decoded audio the mocked AudioContext returns for the next decode. Each
// test sets it to drive the validation branch (truncated / silent / good).
let nextDecoded: { duration: number; peak: number } | null = {
  duration: 5,
  peak: 0.5,
}

// The duration (seconds) the mocked <audio> element reports for an uploaded
// file, driving readAudioDuration in the uploadFile path.
let nextUploadDuration = 5

class MockTrack {
  stopped = 0
  stop(): void {
    this.stopped += 1
  }
}

class MockStream {
  tracks = [new MockTrack()]
  getTracks(): MockTrack[] {
    return this.tracks
  }
}

class MockMediaRecorder {
  static isTypeSupported = (): boolean => true
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null

  constructor(
    public stream: unknown,
    public options?: { mimeType?: string },
  ) {}

  start(_timeslice?: number): void {
    this.state = 'recording'
  }

  stop(): void {
    this.state = 'inactive'
    // A real recorder flushes a final chunk before onstop; emit one so the
    // hook's chunk buffer is non-empty and reaches the decode-validation path.
    this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) })
    this.onstop?.()
  }
}

class MockAudioContext {
  closed = 0
  async decodeAudioData(_buf: ArrayBuffer): Promise<{
    numberOfChannels: number
    duration: number
    getChannelData: () => Float32Array
  }> {
    if (!nextDecoded) throw new Error('decode failed')
    const { duration, peak } = nextDecoded
    return {
      numberOfChannels: 1,
      duration,
      getChannelData: () => new Float32Array([peak, -peak, 0]),
    }
  }
  close(): Promise<void> {
    this.closed += 1
    return Promise.resolve()
  }
}

// jsdom never loads media, so <audio> metadata events never fire on their own.
// This resolves onloadedmetadata with a controllable duration so the uploadFile
// length check (readAudioDuration) can run.
class MockAudio {
  preload = ''
  duration = 5
  onloadedmetadata: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_value: string) {
    this.duration = nextUploadDuration
    setTimeout(() => this.onloadedmetadata?.(), 0)
  }
}

const setupNavigator = (): void => {
  Object.defineProperty(global.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(() => Promise.resolve(new MockStream())) },
  })
}

// Drive the recorder from idle to a stopped clip, waiting out getUserMedia, the
// elapsed-timer ticks, and the async decode. `timerSec` seconds of wall clock
// are advanced so the timer reads a real length to validate the decode against.
const recordAndStop = async (
  result: { current: ReturnType<typeof useRobocallRecorder> },
  timerSec: number,
): Promise<void> => {
  act(() => result.current.start())
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(timerSec * 1000)
  })
  act(() => result.current.stop())
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

describe('useRobocallRecorder', () => {
  const origArrayBuffer = Blob.prototype.arrayBuffer

  beforeEach(() => {
    vi.useFakeTimers()
    nextDecoded = { duration: 5, peak: 0.5 }
    nextUploadDuration = 5
    setupNavigator()
    vi.stubGlobal('MediaRecorder', MockMediaRecorder)
    vi.stubGlobal('AudioContext', MockAudioContext)
    vi.stubGlobal('Audio', MockAudio)
    URL.createObjectURL = vi.fn(() => 'blob:mock')
    URL.revokeObjectURL = vi.fn()
    // jsdom's Blob.arrayBuffer doesn't resolve under fake timers; stub it so the
    // hook's decode path actually reaches the mocked AudioContext.
    Blob.prototype.arrayBuffer = () => Promise.resolve(new ArrayBuffer(8))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Blob.prototype.arrayBuffer = origArrayBuffer
  })

  it('rejects a truncated clip (decoded length far below the timer)', async () => {
    // 44s bug shape: the timer ran ~5s but only ~1s of audio decoded.
    nextDecoded = { duration: 1, peak: 0.5 }
    const { result } = renderHook(() => useRobocallRecorder(60))

    await recordAndStop(result, 5)

    expect(result.current.status).toBe('idle')
    expect(result.current.recording).toBeNull()
    expect(result.current.error).toBe(RECORDING_UNUSABLE_MESSAGE)
  })

  it('rejects a silent clip (peak below the floor)', async () => {
    nextDecoded = { duration: 5, peak: 0.001 }
    const { result } = renderHook(() => useRobocallRecorder(60))

    await recordAndStop(result, 5)

    expect(result.current.status).toBe('idle')
    expect(result.current.recording).toBeNull()
    expect(result.current.error).toBe(RECORDING_UNUSABLE_MESSAGE)
  })

  it('captures a real clip (full length + audible peak)', async () => {
    nextDecoded = { duration: 5, peak: 0.5 }
    const { result } = renderHook(() => useRobocallRecorder(60))

    await recordAndStop(result, 5)

    expect(result.current.status).toBe('preview')
    expect(result.current.recording).not.toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.recording?.durationSec).toBe(5)
  })

  it('captures when the browser has no AudioContext (cannot verify, so accept)', async () => {
    vi.stubGlobal('AudioContext', undefined)
    vi.stubGlobal('webkitAudioContext', undefined)
    const { result } = renderHook(() => useRobocallRecorder(60))

    await recordAndStop(result, 5)

    expect(result.current.status).toBe('preview')
    expect(result.current.recording).not.toBeNull()
    // Falls back to the wall-clock timer for the length.
    expect(result.current.recording?.durationSec).toBe(5)
  })

  it('rejects a silent uploaded file and revokes its object URL', async () => {
    nextUploadDuration = 10
    nextDecoded = { duration: 10, peak: 0.001 }
    const { result } = renderHook(() => useRobocallRecorder(60))
    const file = new File(['x'], 'clip.mp3', { type: 'audio/mpeg' })

    act(() => result.current.uploadFile(file))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.recording).toBeNull()
    expect(result.current.error).toBe(
      'That file has no sound. Choose a different recording.',
    )
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('captures an uploaded file with audible sound', async () => {
    nextUploadDuration = 10
    nextDecoded = { duration: 10, peak: 0.5 }
    const { result } = renderHook(() => useRobocallRecorder(60))
    const file = new File(['x'], 'clip.mp3', { type: 'audio/mpeg' })

    act(() => result.current.uploadFile(file))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(result.current.status).toBe('preview')
    expect(result.current.recording).not.toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.recording?.durationSec).toBe(10)
  })
})
