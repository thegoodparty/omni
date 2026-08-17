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
import { friendlyError } from './chatHelpers'

// How often send polls the smooth-reveal counter while draining the tail after
// the network stream ends, plus a backstop tick cap so an unmount mid-drain can
// never wedge the loop (250 * 40ms = 10s ceiling).
const REVEAL_DRAIN_POLL_MS = 40
const REVEAL_DRAIN_MAX_TICKS = 250

// If the stream goes silent for this long, treat it as stalled — the client
// never saw end-of-stream (a proxy drop or a throttled/backgrounded tab can
// swallow the tail + close) — and reconcile with the persisted transcript
// instead of spinning on "Thinking..." forever. The server persists every
// turn, so re-fetching is authoritative. The server sends a ping every 15s
// while the turn is open (including silent tool-arg generation), so 60s of
// silence means at least three missed beats — a genuinely dead stream.
const STREAM_IDLE_MS = 60_000

// The server persists the assistant turn a beat after the stream closes
// (longest on the draft turn's large body write). Poll the transcript until it
// actually contains the finished turn before swapping the live render away, so
// a refetch that predates persistence can't blank the turn. ~8s covers the lag.
const COMMIT_POLL_MS = 200
const COMMIT_MAX_TRIES = 40

// When the stream ended WITHOUT `done` (stall, proxy drop, sleep/wake), the
// server is usually still generating — the draft turn writes tool args for
// minutes and persists only at the end. Poll patiently for the finished turn
// before falling back to a local partial: committing the partial early is what
// froze draft turns mid-sentence until refresh.
const DONELESS_COMMIT_POLL_MS = 2_000
const DONELESS_COMMIT_MAX_TRIES = 90

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
  // Fires once the turn's stream finishes without error, BEFORE the
  // late-persistence commit poll. Use for a post-turn handoff that must run
  // promptly on success (e.g. a deferred create's cache-invalidation callback)
  // rather than waiting out the poll window.
  onTurnSuccess?: () => void
  // Report a stream/network error. `retryable` is false for terminal errors
  // (e.g. a missing conversation) so the consumer can hide the Retry button.
  // Omit to swallow (the user can retry).
  onError?: (message: string, retryable: boolean) => void
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
    opts?: { hidden?: boolean; clientMessageId?: string },
  ) => Promise<void>
  // Synchronous "a turn is actively streaming" check (false once the stream is
  // done and the turn is merely settling). Consumers that push their own
  // optimistic bubble before calling `send` use this — instead of the
  // render-time `sending` — to drop a same-tick double-submit without also
  // blocking a legitimate follow-up send during the settle window.
  isStreaming: () => boolean
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
  // True only once a turn's stream is done and it is merely reconciling
  // persisted history. A new send supersedes a settling turn (aborts its
  // background poll and starts) rather than being dropped by the guard above.
  const settlingRef = useRef(false)
  // The in-flight turn's controller, so unmount can free the stream. Without
  // this a surface that unmounts mid-turn (a drawer closing, a step swapping)
  // leaves the fetch running until the server finishes; a hung stream leaks
  // until GC. Aborting on unmount is what stops it.
  const abortRef = useRef<AbortController | null>(null)
  // A turn settles asynchronously (reveal drain + commit poll), so its state
  // updates can resolve after the surface unmounts. Skip them then — a
  // setState after unmount is at best a no-op warning and, once the test
  // environment is torn down, a hard `window is not defined` throw.
  const mountedRef = useRef(true)
  useEffect(() => {
    // Arm in the setup body, not just via useRef's initial value: StrictMode
    // (dev) runs setup→cleanup→setup, and the cleanup below flips this false —
    // without re-arming here it would stay false for the real lifetime.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])
  // Drive the smooth reveal off the presence of live segments, not `sending`.
  // A turn drops `sending` the moment its stream is done (so the composer
  // re-enables for a follow-up send) while the reveal keeps typing out the tail
  // until the turn commits to history and `liveSegments` clears.
  const { visibleSegments, revealedRef } = useSmoothReveal(
    liveSegments,
    liveSegments.length > 0,
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
      opts?: { hidden?: boolean; clientMessageId?: string },
    ): Promise<void> => {
      const trimmed = content.trim()
      if (!conversationId || !trimmed) return
      // A turn already in flight: drop this send if it is actively streaming
      // (one turn at a time), but supersede it if it is only settling — abort
      // its background persistence poll and start the new turn now.
      if (sendingRef.current) {
        if (!settlingRef.current) return
        abortRef.current?.abort()
      }
      const chatApi = apiRef.current
      const scope = handlersRef.current
      sendingRef.current = true
      settlingRef.current = false
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
      abortRef.current = abortController
      let stalled = false
      // Whether the server signaled a finished turn. Without it the turn may
      // still be generating server-side, so the commit poll waits much longer.
      let doneSeen = false
      // The id the server assigns the finished assistant turn (from `done`), so
      // the commit can wait for that exact turn to appear in the transcript.
      let doneMessageId: string | null = null
      try {
        const iterator = chatApi
          .streamMessage({
            conversationId,
            content: trimmed,
            // Replay the caller's id on retry so the server's partial unique
            // index on (conversation_id, client_message_id) dedupes the turn.
            clientMessageId: opts?.clientMessageId ?? crypto.randomUUID(),
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
            doneSeen = true
            doneMessageId = event.assistantMessageId ?? null
          } else if (event.type === 'error') {
            // An aborted turn is intentional (the surface closed / a new turn
            // superseded it), not a failure to surface to the user.
            if (event.code !== 'aborted') {
              scope.onError?.(
                event.message || friendlyError(event.code),
                event.retryable,
              )
            }
            errorSeen = true
            break
          }
        }
        // On an error the server has no new persisted turn to swap in, and
        // reloading would revert the optimistic user message; skip the handoff.
        if (!errorSeen) {
          // Reconcile with persisted history only while this turn still owns the
          // stream AND hasn't been externally abandoned:
          //   - a STALL self-aborts to kill the dead stream but must still
          //     reconcile (and keep POLLING for a late-persisted turn) — that is
          //     the whole point of stall recovery;
          //   - an unmount or a superseding send (which reassigns abortRef) must
          //     stop, so we don't touch state or fire a stray listMessages after
          //     the surface is gone (which, in tests, bleeds into the next case).
          const canReconcile = (): boolean =>
            mountedRef.current &&
            abortRef.current === abortController &&
            (!abortController.signal.aborted || stalled)
          // The turn produced its content without error — fire the success
          // handoff now, before the (possibly long) commit poll below. NOT on a
          // stall: the server is still generating, so a handoff that swaps the
          // host surface (e.g. a deferred create's onChatCreated) would unmount
          // us mid-generation. A stall reconciles via the poll instead.
          if (!stalled) scope.onTurnSuccess?.()
          // The stream is done: drop `sending` so the composer re-enables for a
          // follow-up send, and mark the turn settling so that send supersedes
          // the drain + reconcile below instead of being blocked by it. The live
          // render stays up (off `liveSegments`, not `sending`) so it never
          // blanks while we poll; `sendingRef` stays set until this turn settles.
          if (canReconcile()) setSending(false)
          settlingRef.current = true
          // On a clean finish, let the smooth reveal type out the tail before
          // committing, so the last words don't snap in. A supersede/unmount
          // aborts it. On a stall there is nothing left to type out.
          if (!stalled) {
            const total = segmentsTextLength(segments)
            let ticks = 0
            while (
              revealedRef.current < total &&
              ticks < REVEAL_DRAIN_MAX_TICKS &&
              !abortController.signal.aborted
            ) {
              await new Promise((resolve) =>
                setTimeout(resolve, REVEAL_DRAIN_POLL_MS),
              )
              ticks += 1
            }
          }
          // Match the finished turn in persisted history on the server-assigned
          // id when we have it, else on any assistant turn not already in the
          // transcript before this turn.
          const priorIds = new Set(messagesRef.current.map((m) => m.id))
          const hasTurn = (h: ChatMessageDto[]): boolean =>
            doneMessageId !== null
              ? h.some((m) => m.id === doneMessageId)
              : h.some((m) => m.role === 'assistant' && !priorIds.has(m.id))
          // Reconcile with persisted history unless externally aborted (a stall
          // still reconciles — see above). The live turn stays rendered
          // throughout so a refetch that predates persistence can't blank it.
          if (canReconcile()) {
            // Poll for late persistence only when this turn produced content. A
            // degenerate/empty stream has no turn to wait for.
            let history = await chatApi.listMessages(conversationId)
            if (segments.length > 0) {
              const pollMs = doneSeen ? COMMIT_POLL_MS : DONELESS_COMMIT_POLL_MS
              const maxTries = doneSeen
                ? COMMIT_MAX_TRIES
                : DONELESS_COMMIT_MAX_TRIES
              let commitTries = 0
              while (
                !hasTurn(history) &&
                commitTries < maxTries &&
                canReconcile()
              ) {
                await new Promise((resolve) => setTimeout(resolve, pollMs))
                if (!canReconcile()) break
                history = await chatApi.listMessages(conversationId)
                commitTries += 1
              }
            }
            // Commit only if this turn is still current. Swap to the canonical
            // transcript once it contains the turn (or for an empty stream); if
            // persistence lagged the whole window, keep the finished turn on
            // screen by appending what streamed. Clear the live render in the
            // same tick so the swap never double-renders or blanks.
            if (canReconcile()) {
              if (segments.length === 0 || hasTurn(history)) {
                setMessages(history)
                // A stalled turn deferred its success handoff (we skipped it
                // above because the server might still be generating). The turn
                // has now landed in persisted history, so the server is
                // provably finished — fire the handoff here instead.
                if (stalled && hasTurn(history)) scope.onTurnSuccess?.()
              } else {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: doneMessageId ?? `local-${crypto.randomUUID()}`,
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
                  },
                ])
              }
              setLiveSegments([])
            }
          }
        }
      } catch {
        // An intentional abort (unmount, or a fresh turn superseding this one)
        // is not a failure to report — the surface is gone or moving on.
        if (!abortController.signal.aborted) {
          scope.onError?.('Something went wrong. Please try again.', true)
        }
      } finally {
        // Free the underlying stream/fetch (a no-op after a clean finish; frees
        // the socket when we bailed on a stall). Only clear the shared turn
        // state if THIS turn is still the current one — a follow-up send that
        // superseded us mid-settle already owns sendingRef/liveSegments/sending.
        abortController.abort()
        // Skip the state teardown after unmount (the setState calls would throw
        // once the environment is gone) or when a follow-up send has superseded
        // us and already owns this state.
        if (mountedRef.current && abortRef.current === abortController) {
          abortRef.current = null
          setLiveSegments([])
          scope.onTurnSettle?.()
          settlingRef.current = false
          sendingRef.current = false
          setSending(false)
        }
      }
    },
    [revealedRef],
  )

  const isStreaming = useCallback(
    () => sendingRef.current && !settlingRef.current,
    [],
  )

  return {
    messages,
    setMessages,
    liveSegments,
    visibleSegments,
    sending,
    send,
    isStreaming,
  }
}
