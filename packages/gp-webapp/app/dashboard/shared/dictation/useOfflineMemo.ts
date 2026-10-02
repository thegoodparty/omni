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
import { PENDING_QUERY_KEY_PREFIX } from 'app/dashboard/issue-capture/[outreachId]/queries'
import type { DictationStatus } from './useDictation'
import type { UseDictationAppendResult } from './useDictationAppend'
import {
  drainQueue,
  enqueue,
  type QueueEntry,
  type QueuedMemo,
  type SendOutcome,
} from './offlineMemoQueue'

// Identical on both products: neither names the person on the other side.
export const OFFLINE_MEMO_COPY = {
  saved: 'Saved on your phone. It will be sent when you have signal.',
  recorded: 'Note recorded on your phone.',
}

// A socket that has not opened in this long will not carry a memo either,
// so the phone records it instead.
const SOCKET_OPEN_TIMEOUT_MS = 3_000

// A memo is a sentence or two. This stops a mic left running in a pocket.
const MAX_RECORDING_MS = 2 * 60_000

type LocalStatus = Extract<
  DictationStatus,
  'idle' | 'requesting_mic' | 'recording' | 'error'
>

export type HoldInput = {
  interaction:
    | { kind: 'knock'; payload: RecordDoorKnockInteraction }
    | {
        kind: 'call'
        payload: { listId: number; request: RecordPhoneBankingCall }
      }
    | null
  memo: QueuedMemo | null
}

const memoKey = (reference: QueuedMemo['reference']): string =>
  reference.channel === 'door_knock'
    ? reference.knockClientKey
    : `${reference.entryId}:${reference.personId}`

const activeOrg = (): string => getCookie(ORG_SLUG_COOKIE) || ''

// A refusal the server will repeat: drop the entry. Anything else (no
// response, a 5xx, a timeout, a rate limit) is worth another try later.
const isRefusal = (err: unknown): boolean => {
  const status = err instanceof FetchError ? err.status : undefined
  return (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  )
}

const sendMemo = async (
  entry: Extract<QueueEntry, { kind: 'memo' }>,
): Promise<void> => {
  const { reference, text, analytics } = entry.payload
  if (entry.blob !== undefined) {
    const { data } = await clientRequest(
      'POST /v1/constituent-feedback/audio-upload-url',
      { clientKey: reference.clientKey },
    )
    const upload = await fetch(data.uploadUrl, {
      method: 'PUT',
      body: entry.blob,
    })
    // An expired URL is renewed on the next drain, so this is a retry.
    if (!upload.ok) throw new Error(`Memo upload failed: ${upload.status}`)
    await clientRequest('POST /v1/constituent-feedback', {
      ...reference,
      audioKey: data.audioKey,
      captureMethod: 'dictation_offline',
    })
  } else if (text !== undefined) {
    await clientRequest('POST /v1/constituent-feedback', {
      ...reference,
      ...text,
    })
  }
  trackEvent(EVENTS.IssueCapture.MemoUploaded, {
    ...analytics,
    queuedForMs: Date.now() - entry.createdAt,
  })
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
      await sendMemo(entry)
    }
    return 'sent'
  } catch (err) {
    if (isRefusal(err)) return 'rejected'
    throw err
  }
}

// A drain that stops early leaves the rest for the next one. One that sent
// something re-reads the review lists, so "Notes to review" counts what just
// arrived.
const drain = (queryClient: QueryClient): void => {
  if (!navigator.onLine) return
  drainQueue(send)
    .then((sent) => {
      if (sent > 0) {
        void queryClient.invalidateQueries({
          queryKey: PENDING_QUERY_KEY_PREFIX,
        })
      }
    })
    .catch(() => undefined)
}

// Sends what the phone is holding whenever it can: on mount, when the
// browser comes back online, and when the app comes back into view. Mounted
// once on each page that captures memos (the walk, the volunteer walk, the
// phone caller), so a canvasser who closed the door's form and walked on
// still sends everything, and by every capture form. `drainQueue` runs one
// drain at a time, so the two never send an entry twice.
export const useOfflineQueueDrain = (): void => {
  const queryClient = useQueryClient()
  useEffect(() => {
    const onOnline = () => drain(queryClient)
    const onVisible = () => {
      if (document.visibilityState === 'visible') drain(queryClient)
    }
    drain(queryClient)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [queryClient])
}

// The memo field's mic, with a way through a dead zone. With signal it is
// the live dictation it wraps. Without (offline, or a socket that does not
// open in three seconds) the phone records the memo itself, and Save holds
// it with its knock or call in IndexedDB until there is signal to send them,
// knock first. It drains the queue too (`useOfflineQueueDrain`).
export const useOfflineMemo = ({
  dictation,
}: {
  dictation: UseDictationAppendResult
}): {
  // What the mic button and its feedback read.
  mic: UseDictationAppendResult
  // A finished recording, waiting for Save.
  audio: Blob | null
  // Drops the recording, for a Cancel.
  discard: () => void
  hold: (input: HoldInput) => Promise<void>
} => {
  const [mode, setMode] = useState<'live' | 'local'>('live')
  const [localStatus, setLocalStatus] = useState<LocalStatus>('idle')
  const [localError, setLocalError] = useState<string | null>(null)
  const [audio, setAudio] = useState<Blob | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const limitRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dictationRef = useRef(dictation)
  dictationRef.current = dictation
  const mountedRef = useRef(true)
  const queryClient = useQueryClient()

  const stopLocal = useCallback(async (): Promise<void> => {
    if (limitRef.current !== null) clearTimeout(limitRef.current)
    limitRef.current = null
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
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
    // The form closed while the mic was being granted.
    if (!mountedRef.current) {
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
      setAudio(new Blob(chunks, { type: recorder.mimeType }))
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
  // the timeout, hands the memo to the phone.
  const previousStatus = useRef(dictation.status)
  useEffect(() => {
    const previous = previousStatus.current
    previousStatus.current = dictation.status
    if (dictation.status === 'connecting') {
      const timer = setTimeout(() => {
        void dictationRef.current.stop()
        void startLocal()
      }, SOCKET_OPEN_TIMEOUT_MS)
      return () => clearTimeout(timer)
    }
    if (previous === 'connecting' && dictation.status === 'error') {
      void startLocal()
    }
    return undefined
  }, [dictation.status, startLocal])

  useOfflineQueueDrain()

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (limitRef.current !== null) clearTimeout(limitRef.current)
      // Leaving mid-recording drops it: there is no Save left to hold it.
      if (recorderRef.current?.state === 'recording') {
        recorderRef.current.onstop = null
        recorderRef.current.stop()
      }
      for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    }
  }, [])

  const toggle = useCallback(async (): Promise<void> => {
    if (mode === 'local' && localStatus === 'recording') return stopLocal()
    if (mode === 'local' && localStatus === 'requesting_mic') return
    if (dictation.active) return dictation.stop()
    if (!navigator.onLine) return startLocal()
    setMode('live')
    return dictation.start()
  }, [dictation, localStatus, mode, startLocal, stopLocal])

  const hold = useCallback(
    async ({ interaction, memo }: HoldInput): Promise<void> => {
      const createdAt = Date.now()
      const organizationSlug = activeOrg()
      const entries: QueueEntry[] = []
      if (interaction?.kind === 'knock') {
        entries.push({
          id: `knock:${interaction.payload.clientKey}`,
          kind: 'knock',
          organizationSlug,
          payload: interaction.payload,
          createdAt,
        })
      } else if (interaction?.kind === 'call') {
        const { entryId, personId } = interaction.payload.request
        entries.push({
          id: `call:${entryId}:${personId ?? ''}`,
          kind: 'call',
          organizationSlug,
          payload: interaction.payload,
          createdAt,
        })
      }
      if (memo !== null) {
        entries.push({
          id: `memo:${memoKey(memo.reference)}`,
          kind: 'memo',
          organizationSlug,
          payload: memo,
          ...(audio !== null ? { blob: audio } : {}),
          createdAt,
        })
      }
      await enqueue(entries)
      if (memo !== null) {
        trackEvent(EVENTS.IssueCapture.MemoQueuedOffline, memo.analytics)
      }
      setAudio(null)
      drain(queryClient)
    },
    [audio, queryClient],
  )

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

  const discard = useCallback(() => setAudio(null), [])

  return { mic, audio, discard, hold }
}
