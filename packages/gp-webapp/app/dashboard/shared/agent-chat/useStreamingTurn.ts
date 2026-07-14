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

      try {
        for await (const event of chatApi.streamMessage({
          conversationId,
          content: trimmed,
          clientMessageId: crypto.randomUUID(),
        })) {
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
          } else if (event.type === 'error') {
            scope.onError?.(event.message)
          }
        }
        // Hold the swap to persisted history until the smooth reveal has typed
        // out the tail, so the last words don't snap in on the handoff.
        const total = segmentsTextLength(segments)
        let ticks = 0
        while (revealedRef.current < total && ticks < REVEAL_DRAIN_MAX_TICKS) {
          await new Promise((resolve) =>
            setTimeout(resolve, REVEAL_DRAIN_POLL_MS),
          )
          ticks += 1
        }
        const history = await chatApi.listMessages(conversationId)
        setMessages(history)
      } catch {
        scope.onError?.('Something went wrong. Please try again.')
      } finally {
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
