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
  // The URL currently held in `recording`; revoked before replacing so
  // discarded/re-recorded clips don't leak object URLs.
  const urlRef = useRef<string | null>(null)

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
          const blob = new Blob(chunksRef.current, {
            type: mimeType ?? 'audio/webm',
          })
          const url = URL.createObjectURL(blob)
          // elapsedSec is the wall-clock recording length; the blob has no
          // reliable duration metadata, so the timer is the source of truth.
          setElapsedSec((secs) => {
            setCaptured({ blob, url, durationSec: Math.max(1, secs) })
            return secs
          })
        }
        setElapsedSec(0)
        setStatus('recording')
        recorder.start()
        tickRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000)
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
