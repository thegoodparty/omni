'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ROBOCALL_AUDIO_ALLOWED_MIME_TYPES } from '@goodparty_org/contracts'

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
// an uploaded clip can be length-checked the same way a recording is. Resolves
// null when the browser can't decode the file, so the caller rejects it rather
// than treating an undecodable file as a 0-second (length-passing) clip.
const readAudioDuration = (url: string): Promise<number | null> =>
  new Promise((resolve) => {
    const el = new Audio()
    el.preload = 'metadata'
    el.onloadedmetadata = () =>
      // Round UP: a 60.4s clip exceeds the 60s delivery cap, so it must fail
      // the > maxSeconds check rather than round down to a passing 60.
      resolve(Number.isFinite(el.duration) ? Math.ceil(el.duration) : null)
    el.onerror = () => resolve(null)
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
  // True while a getUserMedia call is in flight, so a second Record click
  // before it resolves can't open (and leak) a second MediaStream — status is
  // still 'idle' during that async window, so the UI can't block it. reset()
  // clears it, which also signals an in-flight start to abort (the flow host
  // stays mounted, so mountedRef alone can't catch a close/Back mid-prompt).
  const startingRef = useRef(false)
  // Bumped on every uploadFile call and on reset, so a superseded/again-reset
  // duration decode drops its object URL instead of capturing on a stale flow.
  const uploadReqRef = useRef(0)

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
    // Synchronous in-flight guard: blocks a double-click before the async
    // getUserMedia resolves (status is still 'idle' then, so the UI can't).
    if (startingRef.current) return
    startingRef.current = true
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      startingRef.current = false
      setError('Recording is not supported in this browser')
      return
    }
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        // Abort if the flow unmounted OR was reset/closed while the mic prompt
        // was open (reset clears startingRef): release the just-granted stream
        // and don't arm anything, so the mic never opens on a closed flow.
        if (!mountedRef.current || !startingRef.current) {
          stream.getTracks().forEach((t) => t.stop())
          startingRef.current = false
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
        // Recording is armed; the button is now Stop, so release the guard for
        // the next idle -> record cycle.
        startingRef.current = false
      })
      .catch(() => {
        startingRef.current = false
        setError('Microphone permission is required to record')
      })
  }, [maxSeconds, setCaptured, stop, stopStream])

  const uploadFile = useCallback(
    (file: File | null | undefined) => {
      setError(null)
      if (!file) return
      // Match the server's allowlist (what the presign policy will accept), not
      // a broad audio/* wildcard — otherwise e.g. audio/flac previews fine then
      // fails at save with a misleading "try re-recording" error.
      const allowed: readonly string[] = ROBOCALL_AUDIO_ALLOWED_MIME_TYPES
      if (!allowed.includes(file.type)) {
        setError('Upload an MP3, WAV, M4A, or OGG file')
        return
      }
      const requestId = uploadReqRef.current + 1
      uploadReqRef.current = requestId
      const url = URL.createObjectURL(file)
      void readAudioDuration(url).then((durationSec) => {
        // Superseded by a reset (close/Back/re-record) or a newer upload while
        // the decode was pending: drop this URL, don't capture on a stale flow.
        if (requestId !== uploadReqRef.current) {
          URL.revokeObjectURL(url)
          return
        }
        if (durationSec === null) {
          URL.revokeObjectURL(url)
          setError("We couldn't read that audio file. Try a different format.")
          return
        }
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
    // Detach handlers before stopping so an in-flight recording's onstop can't
    // fire against the just-cleared chunks (a phantom "empty recording" error
    // or 1s clip); then stop it and release the mic.
    const rec = recorderRef.current
    if (rec) {
      rec.ondataavailable = null
      rec.onstop = null
      if (rec.state !== 'inactive') rec.stop()
    }
    stopStream()
    revokeUrl()
    // Abort any in-flight getUserMedia (start's .then bails on this) and any
    // pending upload decode.
    startingRef.current = false
    uploadReqRef.current += 1
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
