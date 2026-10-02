import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import type {
  RecordDoorKnockInteraction,
  RecordPhoneBankingCall,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { getCookie } from 'helpers/cookieHelper'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { ORG_SLUG_COOKIE } from '@shared/organizations/constants'
import { reportErrorToSentry } from '@shared/sentry'
import { PENDING_QUERY_KEY_PREFIX } from 'app/dashboard/issue-capture/[outreachId]/queries'
import type { DictationStatus } from './useDictation'
import type { UseDictationAppendResult } from './useDictationAppend'
import {
  drainQueue,
  enqueue,
  removeFromQueue,
  type QueueEntry,
  type QueuedMemo,
  type SendOutcome,
} from './offlineMemoQueue'

// Identical on both products: none of them names the person on the other
// side.
export const OFFLINE_MEMO_COPY = {
  // Nothing reached the server: the knock or call and its memo wait.
  saved: 'Saved on your phone. It will be sent when you have signal.',
  // The knock or call saved; only the recording waits, and it goes now.
  sending: 'Note saved on your phone. Sending it now.',
  recorded: 'Note recorded on your phone.',
}

// A socket that has not opened in this long will not carry a memo either,
// so the phone records it instead.
const SOCKET_OPEN_TIMEOUT_MS = 3_000

// A memo is a sentence or two. This stops a mic left running in a pocket,
// and keeps the recording under the upload's 5 MB cap.
const MAX_RECORDING_MS = 2 * 60_000

// What MediaRecorder writes when it does not say; the server reads the
// container, not the type.
const FALLBACK_AUDIO_TYPE = 'audio/webm'

// The refusals the server will repeat, with the reason in a JSON body. A 403
// is one: knocks and calls are Pro-gated, so a lapsed Pro is refused every
// time and would otherwise block every memo behind it. A 401 is not: right
// after the phone reconnects, the webapp proxy can forward a request before
// the session token has refreshed, and dropping the queue on that would lose
// every door it holds.
const REFUSAL_STATUSES = new Set([400, 403, 404, 409, 422])

type LocalStatus = Extract<
  DictationStatus,
  'idle' | 'requesting_mic' | 'recording' | 'error'
>

export type HoldInput = {
  // Names the door or the call: the stop target for a knock, and
  // `entryId:personId` for a call. The memo shares it.
  key: string
  interaction:
    | { kind: 'knock'; payload: RecordDoorKnockInteraction }
    | {
        kind: 'call'
        payload: { listId: number; request: RecordPhoneBankingCall }
      }
    | null
  memo: QueuedMemo | null
}

const activeOrg = (): string => getCookie(ORG_SLUG_COOKIE) || ''

export const isRefusal = (err: unknown): boolean =>
  err instanceof FetchError &&
  err.status !== undefined &&
  REFUSAL_STATUSES.has(err.status) &&
  typeof err.data === 'object' &&
  err.data !== null

// A request that never got an answer: no signal, or not enough of it.
export const isNetworkError = (err: unknown): boolean =>
  err instanceof FetchError
    ? err.response === undefined
    : err instanceof TypeError

const sendMemo = async (
  entry: Extract<QueueEntry, { kind: 'memo' }>,
): Promise<SendOutcome> => {
  const { reference, text, analytics } = entry.payload
  // The upload policy refuses an empty file every time; one queued before
  // empty recordings stopped being kept goes rather than blocking the queue.
  if (text === undefined && entry.blob !== undefined && entry.blob.size === 0) {
    return 'rejected'
  }
  // The contract takes one source of words. Text the canvasser typed or
  // dictated is what they meant to keep, and it needs no transcription, so
  // it wins; the recording is dropped with the entry once the text lands.
  if (text !== undefined) {
    await clientRequest('POST /v1/constituent-feedback', {
      ...reference,
      ...text,
    })
  } else if (entry.blob !== undefined) {
    const { data } = await clientRequest(
      'POST /v1/constituent-feedback/audio-upload-url',
      {
        clientKey: reference.clientKey,
        contentType: entry.blob.type || FALLBACK_AUDIO_TYPE,
      },
    )
    // A presigned POST: the policy fields, then the file last.
    const form = new FormData()
    Object.entries(data.fields).forEach(([name, value]) =>
      form.append(name, value),
    )
    form.append('file', entry.blob)
    const upload = await fetch(data.uploadUrl, { method: 'POST', body: form })
    if (!upload.ok) {
      // S3 refuses the same file the same way every time (too large, the
      // wrong type), so the memo goes, with S3's reason on record. A 403 is
      // an expired policy and a 5xx is S3's own trouble: both are renewed on
      // the next drain.
      if (
        upload.status >= 400 &&
        upload.status < 500 &&
        upload.status !== 403
      ) {
        reportErrorToSentry(new Error('Memo upload refused'), {
          status: upload.status,
          body: await upload.text(),
        })
        return 'rejected'
      }
      throw new Error(`Memo upload failed: ${upload.status}`)
    }
    await clientRequest('POST /v1/constituent-feedback', {
      ...reference,
      audioKey: data.audioKey,
      captureMethod: 'dictation_offline',
    })
  }
  trackEvent(EVENTS.IssueCapture.MemoUploaded, {
    ...analytics,
    queuedForMs: Date.now() - entry.createdAt,
  })
  return 'sent'
}

const send = async (entry: QueueEntry): Promise<SendOutcome> => {
  // Requests go out under the active org, so another org's entry waits.
  if (entry.organizationSlug !== activeOrg()) return 'deferred'
  try {
    if (entry.kind === 'knock') {
      await clientRequest('POST /v1/door-knocking/interactions', entry.payload)
    } else if (entry.kind === 'call') {
      await clientRequest('POST /v1/phone-banking/lists/:id/calls', {
        id: String(entry.payload.listId),
        ...entry.payload.request,
      })
    } else {
      return await sendMemo(entry)
    }
    return 'sent'
  } catch (err) {
    if (isRefusal(err)) return 'rejected'
    throw err
  }
}

// The pages mounted now that want to re-read what a drain changed. Held
// here rather than passed to each drain, because a drain a form starts (a
// call held while the page is open) has to reach the page too.
const sentListeners = new Set<() => void>()

// A drain that stops early leaves the rest for the next one. One that sent
// something re-reads the review lists, so "Notes to review" counts what just
// arrived, and tells the pages.
const drain = (queryClient: QueryClient): void => {
  if (!navigator.onLine) return
  drainQueue(send)
    .then((sent) => {
      if (sent === 0) return
      void queryClient.invalidateQueries({ queryKey: PENDING_QUERY_KEY_PREFIX })
      sentListeners.forEach((listener) => listener())
    })
    .catch(() => undefined)
}

// Sends what the phone is holding whenever it can: on mount, when the
// browser comes back online, and when the app comes back into view. Mounted
// once on each page that captures memos (the walk, the volunteer walk, the
// phone caller), so a canvasser who closed the door's form and walked on
// still sends everything, and by every capture form. `drainQueue` runs one
// drain at a time, so the two never send an entry twice. `onSent` lets a
// page re-read what a drain changed, whichever drain it was.
export const useOfflineQueueDrain = ({
  onSent,
}: { onSent?: () => void } = {}): void => {
  const queryClient = useQueryClient()
  const onSentRef = useRef(onSent)
  onSentRef.current = onSent
  useEffect(() => {
    const listener = () => onSentRef.current?.()
    sentListeners.add(listener)
    const run = () => drain(queryClient)
    const onVisible = () => {
      if (document.visibilityState === 'visible') run()
    }
    run()
    window.addEventListener('online', run)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      sentListeners.delete(listener)
      window.removeEventListener('online', run)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [queryClient])
}

// The memo field's mic, with a way through a dead zone. With signal it is
// the live dictation it wraps. Without (offline, or a socket that does not
// open in three seconds) the phone records the memo itself, and Save holds
// it with its knock or call in IndexedDB until there is signal to send them,
// knock first. It drains the queue too (`useOfflineQueueDrain`).
//
// `enabled` is whether a memo here can be captured at all: the product's
// flag is on and the conversation happened. Off, the mic is the ordinary
// dictation mic and never records on the phone, because there would be
// nothing to send the recording with, and the flag stays the way to turn the
// whole path off.
export const useOfflineMemo = ({
  dictation,
  enabled,
}: {
  dictation: UseDictationAppendResult
  enabled: boolean
}): {
  // What the mic button and its feedback read.
  mic: UseDictationAppendResult
  // A finished recording, waiting for Save.
  audio: Blob | null
  // The dictation socket failed to open for this form, so its signal will
  // not carry a save either.
  fellBack: boolean
  // Drops the recording, for a Cancel.
  discard: () => void
  hold: (input: HoldInput) => Promise<void>
  // Drops whatever is queued for this door or call: a save that reached
  // the server supersedes it.
  forget: (key: string) => Promise<void>
} => {
  const [mode, setMode] = useState<'live' | 'local'>('live')
  const [localStatus, setLocalStatus] = useState<LocalStatus>('idle')
  const [localError, setLocalError] = useState<string | null>(null)
  const [audio, setAudio] = useState<Blob | null>(null)
  const [fellBack, setFellBack] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const limitRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dictationRef = useRef(dictation)
  dictationRef.current = dictation
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const mountedRef = useRef(true)
  const queryClient = useQueryClient()

  const stopLocal = useCallback(async (): Promise<void> => {
    if (limitRef.current !== null) clearTimeout(limitRef.current)
    limitRef.current = null
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  // Stops a recording and keeps nothing of it.
  const dropLocal = useCallback(() => {
    if (limitRef.current !== null) clearTimeout(limitRef.current)
    limitRef.current = null
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.onstop = null
      recorderRef.current.stop()
    }
    recorderRef.current = null
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
  }, [])

  const startLocal = useCallback(async (): Promise<void> => {
    setMode('local')
    setLocalError(null)
    setLocalStatus('requesting_mic')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : 'Microphone access denied',
      )
      setLocalStatus('error')
      return
    }
    // The form closed, or the memo stopped being capturable, while the mic
    // was being granted.
    if (!mountedRef.current || !enabledRef.current) {
      for (const track of stream.getTracks()) track.stop()
      return
    }
    const chunks: Blob[] = []
    const recorder = new MediaRecorder(stream)
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onstop = () => {
      for (const track of stream.getTracks()) track.stop()
      recorderRef.current = null
      streamRef.current = null
      const recording = new Blob(chunks, {
        type: recorder.mimeType || FALLBACK_AUDIO_TYPE,
      })
      // A stop before any audio arrived (a quick double tap on iOS Safari)
      // is no memo: S3 would refuse the empty file on every drain.
      if (recording.size > 0) setAudio(recording)
      setLocalStatus('idle')
    }
    recorderRef.current = recorder
    streamRef.current = stream
    recorder.start()
    setLocalStatus('recording')
    limitRef.current = setTimeout(() => void stopLocal(), MAX_RECORDING_MS)
  }, [stopLocal])

  // The fallback. `connecting` is the stretch between the mic being granted
  // and the socket's first word; a session that fails inside it, or outlives
  // the timeout, hands the memo to the phone. Only where the memo can be
  // captured: anywhere else the dictation fails the ordinary way.
  const previousStatus = useRef(dictation.status)
  useEffect(() => {
    const previous = previousStatus.current
    previousStatus.current = dictation.status
    if (!enabled) return undefined
    if (dictation.status === 'connecting') {
      const timer = setTimeout(() => {
        setFellBack(true)
        void dictationRef.current.stop()
        void startLocal()
      }, SOCKET_OPEN_TIMEOUT_MS)
      return () => clearTimeout(timer)
    }
    if (previous === 'connecting' && dictation.status === 'error') {
      setFellBack(true)
      void startLocal()
    }
    return undefined
  }, [dictation.status, enabled, startLocal])

  // A memo that stops being capturable (the door turned out not to engage)
  // takes its recording with it, so nothing is kept that cannot be sent.
  useEffect(() => {
    if (enabled) return
    dropLocal()
    setAudio(null)
    setMode('live')
    setLocalStatus('idle')
    setLocalError(null)
  }, [enabled, dropLocal])

  useOfflineQueueDrain()

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // Leaving mid-recording drops it: there is no Save left to hold it.
      dropLocal()
    }
  }, [dropLocal])

  const toggle = useCallback(async (): Promise<void> => {
    if (mode === 'local' && localStatus === 'recording') return stopLocal()
    if (mode === 'local' && localStatus === 'requesting_mic') return
    if (dictation.active) return dictation.stop()
    if (enabled && !navigator.onLine) return startLocal()
    setMode('live')
    return dictation.start()
  }, [dictation, enabled, localStatus, mode, startLocal, stopLocal])

  const hold = useCallback(
    async ({ key, interaction, memo }: HoldInput): Promise<void> => {
      const createdAt = Date.now()
      const organizationSlug = activeOrg()
      const entries: QueueEntry[] = []
      if (interaction?.kind === 'knock') {
        entries.push({
          id: `knock:${key}`,
          kind: 'knock',
          organizationSlug,
          payload: interaction.payload,
          createdAt,
        })
      } else if (interaction?.kind === 'call') {
        entries.push({
          id: `call:${key}`,
          kind: 'call',
          organizationSlug,
          payload: interaction.payload,
          createdAt,
        })
      }
      if (memo !== null) {
        entries.push({
          id: `memo:${key}`,
          kind: 'memo',
          organizationSlug,
          payload: memo,
          ...(audio !== null ? { blob: audio } : {}),
          createdAt,
        })
      }
      await enqueue(entries)
      // Saved again with no memo: the one held from an earlier save would
      // otherwise go out against a knock or call that may now say nobody
      // answered.
      if (memo === null) await removeFromQueue([`memo:${key}`])
      if (memo !== null) {
        trackEvent(EVENTS.IssueCapture.MemoQueuedOffline, memo.analytics)
      }
      setAudio(null)
      drain(queryClient)
    },
    [audio, queryClient],
  )

  const forget = useCallback(
    (key: string) =>
      removeFromQueue([`knock:${key}`, `call:${key}`, `memo:${key}`]),
    [],
  )

  const discard = useCallback(() => setAudio(null), [])

  const mic: UseDictationAppendResult =
    mode === 'local'
      ? {
          status: localStatus,
          error: localError,
          partialTranscript: '',
          active:
            localStatus === 'recording' || localStatus === 'requesting_mic',
          busy: localStatus === 'requesting_mic',
          start: startLocal,
          stop: stopLocal,
          toggle,
        }
      : { ...dictation, toggle }

  return { mic, audio, fellBack, discard, hold, forget }
}
