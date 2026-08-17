'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Textarea } from '@styleguide'
import { ChevronDownIcon, SparklesIcon } from '@styleguide/components/ui/icons'
import {
  AssistantRow,
  InlineSegments,
  ThinkingRow,
  UserBubble,
} from '../../../shared/agent-chat/chatUI'
import { segmentsToLive } from '../../../shared/agent-chat/streaming'
import { useStreamingTurn } from '../../../shared/agent-chat/useStreamingTurn'
import type { AgentChatClient } from '../../../shared/agent-chat/chatClient'
import { useDictationAppend } from '../../shared/useDictationAppend'
import { DictationMicButton } from '../../shared/DictationMicButton'
import { DictationFeedback } from '../../shared/DictationFeedback'
import { chatApi } from '@shared/briefings/chat-api'
import { EMPTY_ANCHOR } from '@shared/briefings/anchorResolver'
import { reportErrorToSentry } from '@shared/sentry'
import type { AnnotationAnchor } from '@shared/briefings/types'
import AskAiSuggestedPills from './AskAiSuggestedPills'

type Props = {
  meetingDate: string
  anchor: AnnotationAnchor | null
  /**
   * When set, the body skips `createBriefingChat` and uses this annotation
   * id to load prior messages directly. Use when reopening an existing
   * chat-kind annotation.
   */
  annotationIdOverride?: string
  /**
   * When true, renders the inline "Briefing assistant" header in the empty
   * state. Sheet container renders its own SheetHeader and sets this false.
   */
  showInlineHeader?: boolean
  /**
   * Cap the scrollable conversation height. Popover uses a constrained
   * `max-h`; Sheet expands to fill remaining vertical space.
   */
  bodyClassName?: string
  /**
   * Active state — when the parent surface closes, set this to false. Gates
   * the override-load effect. The in-flight stream is aborted on unmount
   * (the sheet is conditionally mounted, so closing unmounts this body).
   */
  active?: boolean
  /**
   * Fires once after `POST /v1/briefing-chats` succeeds with the real
   * annotation + conversation ids. The Sheet wires this to mirror-write
   * the chat into the localStorage annotations stub so the highlight
   * layer renders it before the real GET /v1/annotations endpoint exists.
   */
  onChatCreated?: (info: {
    annotationId: string
    conversationId: string
  }) => void
  /**
   * Composer layout. `block` renders a Textarea above an "Ask AI" Button,
   * matching the notes/report sheet pattern.
   */
  composerVariant?: 'block'
  /**
   * Fires when the chat's internal `sending || creating` flips. The host
   * surface uses this to disable destructive actions (e.g. Delete chat)
   * while a stream or chat-creation request is in flight.
   */
  onSendingChange?: (sending: boolean) => void
  /**
   * Fires as soon as the deferred `createBriefingChat` resolves, well
   * before the first stream completes (and before `onChatCreated`, which is
   * intentionally deferred to stream success to avoid unmounting us
   * mid-stream). The host surface uses this to render the Delete chat button
   * against the freshly-minted annotation while still in the empty state.
   */
  onAnnotationIdReady?: (annotationId: string) => void
}

// Mirrors CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER in gp-api's
// chats/services/chatStream.service.ts. Server persists this exact string as
// the assistant content when a stream was aborted before any text was produced.
const CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER =
  '__chat:interrupted_before_output__'

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  web_search: 'Searching the web',
  get_artifacts: 'Searching the briefing',
  district_insights: 'Searching GoodParty data',
  list_district_topics: 'Searching GoodParty data',
  get_my_notes: 'Reading your notes',
}

function toolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] ?? toolName
}

/**
 * Shared chat body — message list, composer, suggested pills. Streaming, smooth
 * reveal, inline tool pills, and the persisted-history handoff come from the
 * shared agent-chat kit (useStreamingTurn + chatUI); this component adds the
 * briefing-specific chrome: deferred create against an annotation, the
 * "interrupted" retry box, the jump-to-latest pill, and suggested pills.
 *
 * The briefing chat is annotation-keyed; a thin adapter maps the shared engine's
 * `conversationId` onto the briefing client's `annotationId`.
 */
export default function AskAiChatBody({
  meetingDate,
  anchor,
  annotationIdOverride,
  showInlineHeader = true,
  bodyClassName,
  active = true,
  onChatCreated,
  onSendingChange,
  onAnnotationIdReady,
}: Props): React.JSX.Element {
  const [annotationId, setAnnotationId] = useState<string | null>(null)
  const [composer, setComposer] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamError, setStreamError] = useState<{
    message: string
    retryable: boolean
  } | null>(null)

  const loadRequestedRef = useRef(false)
  const creatingRef = useRef(false)
  // Synchronous send latch: `busy` is render-time state, so two `deliver`
  // calls in the same tick (a pill click racing an Enter submit) both read it
  // stale and both push an optimistic bubble. This ref bails the second one.
  const deliveringRef = useRef(false)
  const lastUserContentRef = useRef('')
  const pendingChatCreatedRef = useRef<{
    annotationId: string
    conversationId: string
  } | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const wasAtBottomRef = useRef(true)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const dictation = useDictationAppend({
    analyticsLabel: 'ask_ai_chat',
    value: composer,
    onChange: setComposer,
  })

  // Adapter: the shared engine speaks `conversationId`; the briefing client is
  // keyed by `annotationId`. They carry the same message/stream shapes, so this
  // is a pure key rename.
  const streamingApi = useMemo<
    Pick<AgentChatClient, 'streamMessage' | 'listMessages'>
  >(
    () => ({
      streamMessage: ({ conversationId, content, clientMessageId, signal }) =>
        chatApi.streamMessage({
          annotationId: conversationId,
          content,
          clientMessageId,
          signal,
        }),
      listMessages: (conversationId) => chatApi.listMessages(conversationId),
    }),
    [],
  )

  const toolLabel = useCallback(
    (name: string): string => toolDisplayName(name),
    [],
  )

  const { messages, setMessages, visibleSegments, sending, send, isStreaming } =
    useStreamingTurn(streamingApi, {
      toolLabel,
      onTurnStart: () => {
        setStreamError(null)
      },
      onError: (message, retryable) => {
        setStreamError({ message, retryable })
      },
      // Fire the deferred create's cache-invalidation callback once the first
      // stream lands cleanly (before the commit poll). Guarded by the pending
      // ref so it runs only for the create turn, and never on an errored turn
      // (the engine skips onTurnSuccess when the stream errors).
      onTurnSuccess: () => {
        const pending = pendingChatCreatedRef.current
        if (pending) {
          pendingChatCreatedRef.current = null
          onChatCreated?.(pending)
        }
      },
    })

  const busy = sending || loading

  // Notify the host whenever `sending || creating` flips, so it can gate
  // destructive actions (Delete chat) on the active annotation.
  useEffect(() => {
    onSendingChange?.(busy)
  }, [busy, onSendingChange])

  // Override path — load prior messages for an existing chat annotation.
  const loadExistingChat = useCallback(async () => {
    if (!annotationIdOverride) return
    if (loadRequestedRef.current) return
    loadRequestedRef.current = true
    setLoading(true)
    setAnnotationId(annotationIdOverride)
    try {
      const msgs = await chatApi.listMessages(annotationIdOverride)
      setMessages(msgs)
    } catch (err) {
      reportErrorToSentry(err, {
        surface: 'briefing-ask-ai',
        phase: 'init',
        meetingDate,
        annotationIdOverride,
      })
      loadRequestedRef.current = false
      setStreamError({
        message: 'Could not load this chat. Try again.',
        retryable: true,
      })
    } finally {
      setLoading(false)
    }
  }, [annotationIdOverride, meetingDate, setMessages])

  useEffect(() => {
    if (!active || !annotationIdOverride) return
    void loadExistingChat()
  }, [active, annotationIdOverride, loadExistingChat])

  // Deferred create. Returns the existing annotationId, or mints a new chat row
  // and returns its id (null on failure). State commits BEFORE the verification
  // GET so a retry after a thrown GET does not re-create the row.
  const ensureAnnotationId = useCallback(async (): Promise<string | null> => {
    if (annotationId) return annotationId
    if (creatingRef.current) return null
    creatingRef.current = true
    setLoading(true)
    try {
      const created = await chatApi.createBriefingChat({
        meetingDate,
        anchor: anchor ?? EMPTY_ANCHOR,
      })
      setAnnotationId(created.annotationId)
      onAnnotationIdReady?.(created.annotationId)
      // Defer onChatCreated until the first stream lands `done` — firing it here
      // triggers the host's overlay swap, unmounting this body mid-stream.
      pendingChatCreatedRef.current = {
        annotationId: created.annotationId,
        conversationId: created.conversationId,
      }
      // Verification GET: confirms the freshly-minted chat is readable and gives
      // the server a beat to settle before the first POST /messages, which
      // otherwise raced a server-side visibility window (100% first-send fail).
      await chatApi.listMessages(created.annotationId)
      return created.annotationId
    } catch (err) {
      reportErrorToSentry(err, {
        surface: 'briefing-ask-ai',
        phase: 'init',
        meetingDate,
      })
      return null
    } finally {
      creatingRef.current = false
      setLoading(false)
    }
  }, [annotationId, anchor, meetingDate, onAnnotationIdReady])

  // Resolve-or-create the annotation, then stream the turn. `hidden` skips the
  // optimistic user bubble (a retry re-streams an existing turn). Fires the
  // deferred onChatCreated once the turn completes without error.
  const deliver = useCallback(
    async (content: string, opts?: { hidden?: boolean }): Promise<boolean> => {
      const trimmed = content.trim()
      // `isStreaming()` (synchronous) drops a same-tick double-submit while a
      // turn is actively streaming, but — unlike the render-time `busy` — lets
      // a follow-up send through once the prior turn is only settling.
      // `deliveringRef` covers the async create window before `send` is called.
      if (!trimmed || isStreaming() || deliveringRef.current) return false
      deliveringRef.current = true
      try {
        setStreamError(null)
        if (!opts?.hidden) lastUserContentRef.current = trimmed
        // Push the optimistic bubble BEFORE the deferred create so it stays
        // visible through the create round-trip and survives a create failure
        // (the composer is already cleared, so this is the only copy of the
        // user's message). A retry re-streams with `hidden`, so it is never
        // duplicated.
        if (!opts?.hidden) {
          setMessages((prev) => [
            ...prev,
            {
              id: `pending-${crypto.randomUUID()}`,
              conversationId: annotationId ?? '',
              role: 'user',
              content: trimmed,
              createdAt: new Date().toISOString(),
            },
          ])
        }
        let id = annotationId
        if (!id) {
          id = await ensureAnnotationId()
          if (!id) {
            setStreamError({
              message: 'Could not start chat. Try again.',
              retryable: true,
            })
            return false
          }
        }
        // Fire-and-forget: `send` owns the turn from here (its own sendingRef
        // guards it), and the onChatCreated handoff runs via onTurnSuccess.
        // Awaiting would hold deliveringRef across the whole settle window and
        // block a legitimate follow-up send.
        void send(id, trimmed, { hidden: true })
        return true
      } finally {
        deliveringRef.current = false
      }
    },
    [isStreaming, annotationId, ensureAnnotationId, send, setMessages],
  )

  const onSend = useCallback((): void => {
    const text = composer.trim()
    if (!text || busy) return
    if (dictation.active) void dictation.stop()
    setComposer('')
    void deliver(text, { hidden: false })
  }, [composer, busy, dictation, deliver])

  const onRetry = useCallback((): void => {
    setStreamError(null)
    const content = lastUserContentRef.current
    if (content) {
      // Re-stream through `deliver` (hidden — the optimistic bubble already
      // exists) so a post-create retry still fires the deferred onChatCreated
      // handoff, and a create-on-send failure re-attempts the create.
      void deliver(content, { hidden: true })
      return
    }
    // No user turn to replay — a load error. Reload the conversation.
    loadRequestedRef.current = false
    void loadExistingChat()
  }, [deliver, loadExistingChat])

  const onRetryInterrupted = useCallback(
    (interruptedId: string): void => {
      if (!annotationId || busy) return
      const idx = messages.findIndex((m) => m.id === interruptedId)
      if (idx <= 0) return
      const prior = messages[idx - 1]
      if (!prior || prior.role !== 'user') return
      setMessages((prev) => prev.filter((m) => m.id !== interruptedId))
      void send(annotationId, prior.content, { hidden: true })
    },
    [annotationId, busy, messages, setMessages, send],
  )

  const onRetryLastUser = useCallback((): void => {
    if (!annotationId || busy) return
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m && m.role === 'user') {
        void send(annotationId, m.content, { hidden: true })
        return
      }
    }
  }, [annotationId, busy, messages, send])

  // Track whether the user is pinned to the bottom so we follow streaming text
  // only while they haven't scrolled up to read earlier content.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      const atBottom = distance < 80
      wasAtBottomRef.current = atBottom
      setIsAtBottom(atBottom)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight
    } else {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      setIsAtBottom(distance < 80)
    }
  }, [visibleSegments, messages.length])

  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    wasAtBottomRef.current = true
    setIsAtBottom(true)
  }, [])

  // Keep the "new text below" pill visible briefly after the stream ends so the
  // user has time to notice and click.
  const [pillLingering, setPillLingering] = useState(false)
  useEffect(() => {
    if (sending) {
      setPillLingering(true)
      return
    }
    if (!pillLingering) return
    const t = setTimeout(() => setPillLingering(false), 3000)
    return () => clearTimeout(t)
  }, [sending, pillLingering])

  // Project the engine's transcript into render items, mapping the interrupted
  // marker to its own kind and dropping stale markers (a retry that produced a
  // successor supersedes it — keep one only if it's the last item).
  const items = useMemo(() => {
    const mapped = messages.map((m) =>
      m.role !== 'user' && m.content === CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER
        ? { kind: 'interrupted' as const, id: m.id }
        : m.role === 'user'
          ? { kind: 'user' as const, id: m.id, content: m.content }
          : {
              kind: 'assistant' as const,
              id: m.id,
              live: segmentsToLive(m.segments ?? [], m.content),
            },
    )
    return mapped.filter(
      (it, i) => it.kind !== 'interrupted' || i === mapped.length - 1,
    )
  }, [messages])

  // ThinkingRow shows while streaming, and also through the deferred-create
  // gap (loading, with the optimistic user bubble already on screen) so the
  // user isn't left staring at their message with no sign of progress. The
  // `messages.length > 0` guard keeps it off the initial override-path load.
  const working =
    (sending || (loading && messages.length > 0)) &&
    visibleSegments.length === 0
  const lastItem = items[items.length - 1]
  const showBareUserRetry =
    !sending && !loading && !streamError && lastItem?.kind === 'user'
  const showEmptyState =
    !loading && items.length === 0 && !sending && !streamError
  const showJumpPill = !isAtBottom && pillLingering

  return (
    // vaul disables text selection on the drawer and treats pointer-drags as
    // drawer-drags. select-text restores selection; data-vaul-no-drag stops a
    // select-drag from moving the sheet so users can highlight and copy.
    <div className="flex min-h-0 flex-1 flex-col select-text" data-vaul-no-drag>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          className={
            bodyClassName ??
            'flex max-h-[60vh] min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3'
          }
          data-testid="ask-ai-conversation"
        >
          {loading && items.length === 0 && !sending && (
            <div className="text-sm text-muted-foreground">Loading chat...</div>
          )}

          {showEmptyState && showInlineHeader ? (
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                <SparklesIcon className="size-4" aria-hidden />
              </span>
              <span className="text-sm font-semibold">Briefing assistant</span>
            </div>
          ) : null}

          {items.map((item) => {
            if (item.kind === 'interrupted') {
              return (
                <div
                  key={item.id}
                  className="flex flex-col items-start gap-2 self-start rounded-2xl border border-dashed border-base-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
                >
                  <span>Something went wrong.</span>
                  <Button
                    type="button"
                    size="small"
                    variant="outline"
                    onClick={() => onRetryInterrupted(item.id)}
                    disabled={busy}
                  >
                    Retry
                  </Button>
                </div>
              )
            }
            if (item.kind === 'user') {
              return <UserBubble key={item.id}>{item.content}</UserBubble>
            }
            return (
              <AssistantRow key={item.id}>
                <InlineSegments segments={item.live} toolLabel={toolLabel} />
              </AssistantRow>
            )
          })}

          {showBareUserRetry && (
            <div className="flex flex-col items-start gap-2 self-start rounded-2xl border border-dashed border-base-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              <span>Something went wrong.</span>
              <Button
                type="button"
                size="small"
                variant="outline"
                onClick={onRetryLastUser}
                disabled={busy}
              >
                Retry
              </Button>
            </div>
          )}

          {visibleSegments.length > 0 ? (
            <AssistantRow>
              <InlineSegments
                segments={visibleSegments}
                toolLabel={toolLabel}
              />
            </AssistantRow>
          ) : null}

          {working ? <ThinkingRow /> : null}

          {streamError && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <span>{streamError.message}</span>
              {streamError.retryable && (
                <Button
                  type="button"
                  size="small"
                  variant="outline"
                  onClick={onRetry}
                  disabled={busy}
                >
                  Retry
                </Button>
              )}
            </div>
          )}
        </div>

        {showJumpPill && (
          <button
            type="button"
            onClick={jumpToBottom}
            aria-label="Jump to latest message"
            className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-foreground/85 px-3 py-1.5 text-xs font-medium text-background shadow-md backdrop-blur transition-colors hover:bg-foreground"
          >
            <ChevronDownIcon className="size-3.5" aria-hidden />
            <span>New text below</span>
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-base-border bg-background pb-2 pt-4">
        {showEmptyState && (
          <AskAiSuggestedPills
            onSelect={(s) => void deliver(s, { hidden: false })}
            disabled={busy}
          />
        )}
        <div className="relative">
          <Textarea
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key !== 'Enter' ||
                e.shiftKey ||
                e.nativeEvent.isComposing
              ) {
                return
              }
              if (composer.trim().length === 0) return
              e.preventDefault()
              onSend()
            }}
            placeholder="Ask anything..."
            disabled={busy}
            rows={3}
            className="min-h-[96px] resize-none rounded-2xl pr-12"
            aria-label="Ask Assistant message"
          />
          <DictationMicButton
            dictation={dictation}
            idleLabel="Dictate message"
            recordingLabel="Stop dictation"
            disabled={busy}
          />
        </div>
        <Button
          type="button"
          onClick={onSend}
          disabled={composer.trim().length === 0 || busy}
          loading={busy}
          icon={<SparklesIcon className="size-4" aria-hidden />}
          iconPosition="left"
          className="w-full text-sm!"
        >
          Ask Assistant
        </Button>
        <DictationFeedback dictation={dictation} />
      </div>
    </div>
  )
}
