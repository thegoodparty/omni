'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// idle -> recording -> preview (captured, not committed) -> saved. A discard
// from preview/saved returns to idle. Mirrors the design's robocallRecordBar.
export type RobocallRecorderStatus = 'idle' | 'recording' | 'preview' | 'saved'

export interface RobocallRecording {
  blob: Blob
  url: string
  durationSec: number
}

export interface RobocallRecorder {
  status: RobocallRecorderStatus
  // Seconds elapsed while recording (drives the live timer).
  elapsedSec: number
  recording: RobocallRecording | null
  // A getUserMedia / decode failure the UI should surface, or null.
  error: string | null
  start: () => void
  stop: () => void
  discard: () => void
  save: () => void
  uploadFile: (file: File | null | undefined) => void
  reset: () => void
}

const MIME_CANDIDATES = ['audio/webm', 'audio/mp4', 'audio/ogg']

const pickMimeType = (): string | undefined => {
  if (typeof MediaRecorder === 'undefined') return undefined
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported?.(t))
}

// Read an audio file's duration (seconds) via a throwaway <audio> element, so
// an uploaded clip can be length-checked the same way a recording is.
const readAudioDuration = (url: string): Promise<number> =>
  new Promise((resolve) => {
    const el = new Audio()
    el.preload = 'metadata'
    el.onloadedmetadata = () =>
      resolve(Number.isFinite(el.duration) ? Math.round(el.duration) : 0)
    el.onerror = () => resolve(0)
    el.src = url
  })

export const useRobocallRecorder = (maxSeconds: number): RobocallRecorder => {
  const [status, setStatus] = useState<RobocallRecorderStatus>('idle')
  const [elapsedSec, setElapsedSec] = useState(0)
  const [recording, setRecording] = useState<RobocallRecording | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const capRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Mirror of the elapsed count that onstop can read synchronously — reading
  // it here keeps side effects out of the setElapsedSec updater, which React
  // (StrictMode) invokes twice and would otherwise run setCaptured twice.
  const elapsedRef = useRef(0)
  // The URL currently held in `recording`; revoked before replacing so
  // discarded/re-recorded clips don't leak object URLs.
  const urlRef = useRef<string | null>(null)
  // False once unmounted, so a getUserMedia promise that resolves after the
  // flow closes doesn't arm a recorder on a dead component.
  const mountedRef = useRef(true)

  const clearTimers = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
    if (capRef.current) {
      clearTimeout(capRef.current)
      capRef.current = null
    }
  }, [])

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const revokeUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }, [])

  const setCaptured = useCallback(
    (rec: RobocallRecording) => {
      revokeUrl()
      urlRef.current = rec.url
      setRecording(rec)
      setStatus('preview')
    },
    [revokeUrl],
  )

  const stop = useCallback(() => {
    clearTimers()
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
  }, [clearTimers])

  const start = useCallback(() => {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Recording is not supported in this browser')
      return
    }
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        // The flow can unmount while the mic-permission prompt is still open;
        // if so, release the just-granted stream and don't arm anything.
        if (!mountedRef.current) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        chunksRef.current = []
        const mimeType = pickMimeType()
        const recorder = new MediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined,
        )
        recorderRef.current = recorder
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data)
        }
        recorder.onstop = () => {
          stopStream()
          if (chunksRef.current.length === 0) {
            setError('That recording came through empty. Try again.')
            setStatus('idle')
            return
          }
          // Type the blob from the container the recorder actually negotiated
          // (recorder.mimeType), not the requested one — Safari ignores the
          // request and produces audio/mp4, so a hardcoded audio/webm makes
          // <audio> reject it with "no supported sources".
          const type = recorder.mimeType || mimeType || 'audio/webm'
          const blob = new Blob(chunksRef.current, { type })
          const url = URL.createObjectURL(blob)
          // elapsedRef is the wall-clock recording length; the blob has no
          // reliable duration metadata, so the timer is the source of truth.
          setCaptured({
            blob,
            url,
            durationSec: Math.max(1, elapsedRef.current),
          })
        }
        elapsedRef.current = 0
        setElapsedSec(0)
        setStatus('recording')
        // Timeslice so ondataavailable fires each second instead of only once
        // at stop — some browsers otherwise deliver nothing on a short clip.
        recorder.start(1000)
        tickRef.current = setInterval(() => {
          elapsedRef.current += 1
          setElapsedSec(elapsedRef.current)
        }, 1000)
        // Hard cap: a recorded clip can never exceed the delivery limit.
        capRef.current = setTimeout(() => stop(), maxSeconds * 1000)
      })
      .catch(() => setError('Microphone permission is required to record'))
  }, [maxSeconds, setCaptured, stop, stopStream])

  const uploadFile = useCallback(
    (file: File | null | undefined) => {
      setError(null)
      if (!file) return
      if (!file.type.startsWith('audio/')) {
        setError('Upload an audio file (MP3, WAV, or M4A)')
        return
      }
      const url = URL.createObjectURL(file)
      void readAudioDuration(url).then((durationSec) => {
        if (durationSec > maxSeconds) {
          URL.revokeObjectURL(url)
          setError(`Audio must be ${maxSeconds} seconds or less`)
          return
        }
        setCaptured({ blob: file, url, durationSec: Math.max(1, durationSec) })
      })
    },
    [maxSeconds, setCaptured],
  )

  const discard = useCallback(() => {
    revokeUrl()
    elapsedRef.current = 0
    setRecording(null)
    setElapsedSec(0)
    setStatus('idle')
  }, [revokeUrl])

  const save = useCallback(() => {
    setStatus((s) => (s === 'preview' ? 'saved' : s))
  }, [])

  const reset = useCallback(() => {
    clearTimers()
    stopStream()
    revokeUrl()
    elapsedRef.current = 0
    recorderRef.current = null
    chunksRef.current = []
    setRecording(null)
    setElapsedSec(0)
    setError(null)
    setStatus('idle')
  }, [clearTimers, revokeUrl, stopStream])

  // Release the mic, timers, and object URL if the component unmounts
  // mid-recording or holding a preview.
  useEffect(() => reset, [reset])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  return {
    status,
    elapsedSec,
    recording,
    error,
    start,
    stop,
    discard,
    save,
    uploadFile,
    reset,
  }
}
