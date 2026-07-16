import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type {
  AgentChatClient,
  ChatMessageDto,
  ChatStreamEvent,
} from './chatClient'
import {
  segmentsTextLength,
  useSmoothReveal,
  type LiveSegment,
} from './streaming'

// How often send polls the smooth-reveal counter while draining the tail after
// the network stream ends, plus a backstop tick cap so an unmount mid-drain can
// never wedge the loop (250 * 40ms = 10s ceiling).
const REVEAL_DRAIN_POLL_MS = 40
const REVEAL_DRAIN_MAX_TICKS = 250

// If the stream goes silent for this long, treat it as stalled — the client
// never saw end-of-stream (a proxy drop or a throttled/backgrounded tab can
// swallow the tail + close) — and reconcile with the persisted transcript
// instead of spinning on "Thinking..." forever. The server persists every
// turn, so re-fetching is authoritative. Must exceed the longest legitimate
// silence (a native web_search step, ~47s); a server heartbeat can shrink it.
const STREAM_IDLE_MS = 60_000

// The server persists the assistant turn a beat after the stream closes
// (longest on the draft turn's large body write). Poll the transcript until it
// actually contains the finished turn before swapping the live render away, so
// a refetch that predates persistence can't blank the turn. ~8s covers the lag.
const COMMIT_POLL_MS = 200
const COMMIT_MAX_TRIES = 40

type StreamingTurnChatApi = Pick<
  AgentChatClient,
  'streamMessage' | 'listMessages'
>

export interface StreamingTurnHandlers {
  // A tool_call renders as an inline running pill when this returns a label.
  // Tools handled entirely by onEvent (e.g. widget/clarify tools) return null.
  toolLabel: (toolName: string) => string | null
  // Intercept a stream event before default handling. Return true to consume it
  // (default text/pill/result/error handling is skipped for that event).
  // `textLength` is the interleaved-text length so far, for anchoring a widget
  // after the text that preceded its tool call.
  onEvent?: (
    event: ChatStreamEvent,
    ctx: { textLength: () => number },
  ) => boolean
  // Reset scope-specific live state at the start of a turn.
  onTurnStart?: () => void
  // Clear scope-specific live state after a turn settles (success or failure).
  onTurnSettle?: () => void
  // Report a stream/network error. Omit to swallow (the user can retry).
  onError?: (message: string) => void
}

export interface StreamingTurn {
  messages: ChatMessageDto[]
  setMessages: Dispatch<SetStateAction<ChatMessageDto[]>>
  // The full arrived turn; `visibleSegments` is its smooth-revealed prefix.
  // Scopes compare the two lengths to gate widgets on "the text has typed out".
  liveSegments: LiveSegment[]
  visibleSegments: LiveSegment[]
  sending: boolean
  send: (
    conversationId: string,
    content: string,
    opts?: { hidden?: boolean },
  ) => Promise<void>
}

// The shared streaming-turn driver: optimistic user push, interleaved
// text/tool-pill assembly, the streamMessage event loop, and the reveal-drain
// handoff to persisted history. Every ordinance chat runs its turn through this
// so the streaming behavior is one implementation; scope-specific structured
// output (clarify/offer/step widgets, a "generating" label) layers on via the
// handler seams rather than a forked copy of the loop.
export function useStreamingTurn(
  api: StreamingTurnChatApi,
  handlers: StreamingTurnHandlers,
): StreamingTurn {
  const [messages, setMessages] = useState<ChatMessageDto[]>([])
  const messagesRef = useRef(messages)
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])
  const [liveSegments, setLiveSegments] = useState<LiveSegment[]>([])
  const [sending, setSending] = useState(false)
  // Synchronous guard so a fast double-submit can't start two turns before the
  // async setSending re-renders.
  const sendingRef = useRef(false)
  const { visibleSegments, revealedRef } = useSmoothReveal(
    liveSegments,
    sending,
  )

  // Keep send stable while always calling the latest api/handlers (both are
  // recreated each render by the consumer).
  const apiRef = useRef(api)
  const handlersRef = useRef(handlers)
  useEffect(() => {
    apiRef.current = api
    handlersRef.current = handlers
  })

  const send = useCallback(
    async (
      conversationId: string,
      content: string,
      opts?: { hidden?: boolean },
    ): Promise<void> => {
      const trimmed = content.trim()
      if (!conversationId || !trimmed || sendingRef.current) return
      const chatApi = apiRef.current
      const scope = handlersRef.current
      sendingRef.current = true
      setSending(true)
      setLiveSegments([])
      scope.onTurnStart?.()
      if (!opts?.hidden) {
        setMessages((prev) => [
          ...prev,
          {
            id: `pending-${crypto.randomUUID()}`,
            conversationId,
            role: 'user',
            content: trimmed,
            createdAt: new Date().toISOString(),
          },
        ])
      }

      // Build the turn as interleaved text + tool segments so pills render inline
      // in stream order; consecutive text deltas coalesce into one block.
      const segments: LiveSegment[] = []
      const pushText = (delta: string): void => {
        const last = segments[segments.length - 1]
        if (last && last.kind === 'text') {
          segments[segments.length - 1] = {
            kind: 'text',
            text: last.text + delta,
          }
        } else {
          segments.push({ kind: 'text', text: delta })
        }
        setLiveSegments([...segments])
      }

      let errorSeen = false
      const abortController = new AbortController()
      let stalled = false
      // The id the server assigns the finished assistant turn (from `done`), so
      // the commit can wait for that exact turn to appear in the transcript.
      let doneMessageId: string | null = null
      try {
        const iterator = chatApi
          .streamMessage({
            conversationId,
            content: trimmed,
            clientMessageId: crypto.randomUUID(),
            signal: abortController.signal,
          })
          [Symbol.asyncIterator]()
        // Consume events, but race each one against an idle watchdog so a stream
        // that never ends (client never sees end-of-stream) can't wedge the turn
        // on "Thinking..." forever. On idle we stop, abort the dead stream, and
        // fall through to the same persisted-history reconcile the clean-finish
        // path uses.
        while (true) {
          let idleTimer: ReturnType<typeof setTimeout> | undefined
          const idle = new Promise<'idle'>((resolve) => {
            idleTimer = setTimeout(() => resolve('idle'), STREAM_IDLE_MS)
          })
          let step: IteratorResult<ChatStreamEvent, void> | 'idle'
          try {
            step = await Promise.race([iterator.next(), idle])
          } finally {
            if (idleTimer) clearTimeout(idleTimer)
          }
          if (step === 'idle') {
            stalled = true
            // Abort now, before we poll: closing the connection is what tells
            // the server to stop generating and persist the partial turn, so it
            // must happen before the reconcile fetch can hope to load it.
            abortController.abort()
            void iterator.return?.(undefined)
            break
          }
          if (step.done) break
          const event = step.value
          const consumed = scope.onEvent?.(event, {
            textLength: () => segmentsTextLength(segments),
          })
          if (consumed) continue
          if (event.type === 'text') {
            pushText(event.delta)
          } else if (event.type === 'tool_call') {
            if (scope.toolLabel(event.toolName)) {
              segments.push({
                kind: 'tool',
                toolName: event.toolName,
                running: true,
              })
              setLiveSegments([...segments])
            }
          } else if (event.type === 'tool_result') {
            // The tool finished; stop its pill shimmering. Clear the most recent
            // still-running segment for this tool (tools run one at a time).
            for (let i = segments.length - 1; i >= 0; i--) {
              const seg = segments[i]
              if (
                seg &&
                seg.kind === 'tool' &&
                seg.toolName === event.toolName &&
                seg.running
              ) {
                segments[i] = { ...seg, running: false }
                setLiveSegments([...segments])
                break
              }
            }
          } else if (event.type === 'done') {
            doneMessageId = event.assistantMessageId ?? null
          } else if (event.type === 'error') {
            scope.onError?.(event.message)
            errorSeen = true
            break
          }
        }
        // On an error the server has no new persisted turn to swap in, and
        // reloading would revert the optimistic user message; skip the handoff.
        if (!errorSeen) {
          // On a clean finish, hold the swap until the smooth reveal has typed
          // out the tail so the last words don't snap in. On a stall there is
          // nothing left to type out — reconcile immediately.
          if (!stalled) {
            const total = segmentsTextLength(segments)
            let ticks = 0
            while (
              revealedRef.current < total &&
              ticks < REVEAL_DRAIN_MAX_TICKS
            ) {
              await new Promise((resolve) =>
                setTimeout(resolve, REVEAL_DRAIN_POLL_MS),
              )
              ticks += 1
            }
          }
          // Swap to persisted history only once it actually contains this turn.
          // The live turn stays rendered (sending is still true) while we poll,
          // so a refetch that lands before the server has persisted the turn
          // never blanks it. Match on the server-assigned id when we have it,
          // else on any assistant turn that wasn't already in the transcript.
          const priorIds = new Set(messagesRef.current.map((m) => m.id))
          const hasTurn = (h: ChatMessageDto[]): boolean =>
            doneMessageId !== null
              ? h.some((m) => m.id === doneMessageId)
              : h.some((m) => m.role === 'assistant' && !priorIds.has(m.id))
          let history = await chatApi.listMessages(conversationId)
          let commitTries = 0
          while (!hasTurn(history) && commitTries < COMMIT_MAX_TRIES) {
            await new Promise((resolve) => setTimeout(resolve, COMMIT_POLL_MS))
            history = await chatApi.listMessages(conversationId)
            commitTries += 1
          }
          if (hasTurn(history)) {
            setMessages(history)
          } else {
            // Persistence lagged past the poll window (rare — the server
            // normally has the turn immediately). `finally` is about to clear
            // the live render, so swapping in a transcript that lacks this turn
            // would blank it. Instead keep the finished turn on screen by
            // appending what streamed (text + pills); a later transcript load
            // reconciles with the server's authoritative copy.
            const streamed: ChatMessageDto = {
              id: `local-${crypto.randomUUID()}`,
              conversationId,
              role: 'assistant',
              content: segments.reduce(
                (acc, s) => (s.kind === 'text' ? acc + s.text : acc),
                '',
              ),
              createdAt: new Date().toISOString(),
              segments: segments.map((s) =>
                s.kind === 'text'
                  ? { kind: 'text' as const, text: s.text }
                  : { kind: 'tool' as const, toolName: s.toolName },
              ),
            }
            setMessages((prev) => [...prev, streamed])
          }
        }
      } catch {
        scope.onError?.('Something went wrong. Please try again.')
      } finally {
        // Free the underlying stream/fetch (a no-op after a clean finish; frees
        // the socket when we bailed on a stall).
        abortController.abort()
        setLiveSegments([])
        scope.onTurnSettle?.()
        sendingRef.current = false
        setSending(false)
      }
    },
    [revealedRef],
  )

  return {
    messages,
    setMessages,
    liveSegments,
    visibleSegments,
    sending,
    send,
  }
}
