'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { reportErrorToSentry } from '@shared/sentry'
import { Button, ToggleGroup, ToggleGroupItem } from '@styleguide'
import { ThumbsDownIcon, ThumbsUpIcon } from '@styleguide/components/ui/icons'
import {
  ASSISTANT_BUBBLE,
  AssistantRow,
  ChatComposer,
  InlineSegments,
  ThinkingRow,
  UserBubble,
} from '../agent-chat/chatUI'
import { segmentsToLive } from '../agent-chat/streaming'
import { useStreamingTurn } from '../agent-chat/useStreamingTurn'
import { usePinnedAutoScroll } from '../agent-chat/usePinnedAutoScroll'
import { useDictationAppend } from 'app/dashboard/briefings/shared/useDictationAppend'
import type { AiChatClient, AiChatConfig } from './types'
import { CHAT_MAX_W } from './constants'
import AiChatHistoryPopover from './AiChatHistoryPopover'
import { HISTORY_QUERY_KEY } from './useAiChatHistory'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  chatApi: AiChatClient
  config: AiChatConfig
  /** When set, open directly into this conversation (from history). */
  conversationIdOverride?: string
  /** Set false to abort the in-flight stream when the surface closes. */
  active?: boolean
  onConversationCreated?: (conversationId: string) => void
  onSelectConversation?: (conversationId: string) => void
  className?: string
  /**
   * Optional override for assistant message content. When set, a completed
   * assistant turn renders `messageRenderer(content)` in the shared bubble
   * instead of the default markdown + inline tool pills — the escape hatch for
   * a surface that folds structured widgets into the reply. Live streaming
   * always uses the default renderer.
   */
  messageRenderer?: (content: string) => React.ReactNode
  /** Optional content rendered between the messages area and the composer. */
  bottomSlot?: React.ReactNode
  /** Start dictation automatically on open (e.g. when entered via the mic). */
  autoDictate?: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// The generic AI assistant body. Streaming, smooth reveal, inline tool pills,
// the composer, and the persisted-history handoff all come from the shared
// agent-chat kit (useStreamingTurn + chatUI); this component owns only the
// conversation lifecycle for a drawer surface (deferred create, open-into an
// existing conversation, retry) plus its product chrome: the intro typing
// animation, response feedback, starter suggestions, and dictation.
export default function AiChatBody({
  chatApi,
  config,
  conversationIdOverride,
  active = true,
  onConversationCreated,
  onSelectConversation,
  className,
  messageRenderer,
  bottomSlot,
  autoDictate = false,
}: Props): React.JSX.Element {
  const queryClient = useQueryClient()
  const [composer, setComposer] = useState('')
  const dictation = useDictationAppend({
    value: composer,
    onChange: setComposer,
    analyticsLabel: config.title.toLowerCase().replace(/\s+/g, '-') + '-chat',
  })
  const [introProgress, setIntroProgress] = useState(0)
  const [feedback, setFeedback] = useState<
    Record<string, 'up' | 'down' | undefined>
  >({})

  // Wrapper-owned conversation lifecycle. The engine drives one turn at a time
  // against a known conversation id; resolving/creating that id, opening into an
  // existing conversation, and surfacing a retryable error live here.
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [liveStatus, setLiveStatus] = useState('')
  const creatingRef = useRef(false)
  const loadRequestedRef = useRef(false)
  const lastSentRef = useRef('')

  const toolLabel = useCallback(
    (toolName: string): string =>
      config.toolDisplayNames?.[toolName] ?? toolName,
    [config.toolDisplayNames],
  )

  const { messages, setMessages, visibleSegments, sending, send } =
    useStreamingTurn(chatApi, {
      toolLabel,
      onTurnStart: () => setStreamError(null),
      onError: (message) => setStreamError(message),
    })

  const busy = sending || loading

  // Load an existing conversation when opened from history.
  useEffect(() => {
    if (!active || !conversationIdOverride) return
    if (loadRequestedRef.current) return
    loadRequestedRef.current = true
    let cancelled = false
    setLoading(true)
    setConversationId(conversationIdOverride)
    chatApi
      .listMessages(conversationIdOverride)
      .then((msgs) => {
        if (!cancelled) setMessages(msgs)
      })
      .catch((err) => {
        if (cancelled) return
        reportErrorToSentry(err, {
          surface: config.title,
          phase: 'init',
          conversationIdOverride,
        })
        loadRequestedRef.current = false
        setStreamError('Could not load this chat. Try again.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [active, conversationIdOverride, chatApi, config.title, setMessages])

  const ensureConversationId = useCallback(async (): Promise<string | null> => {
    if (conversationId) return conversationId
    if (creatingRef.current) return null
    creatingRef.current = true
    setLoading(true)
    try {
      const { conversationId: id } = await chatApi.createConversation()
      setConversationId(id)
      onConversationCreated?.(id)
      void queryClient.invalidateQueries({
        queryKey: HISTORY_QUERY_KEY(config.title),
      })
      return id
    } catch (err) {
      reportErrorToSentry(err, { surface: config.title, phase: 'init' })
      return null
    } finally {
      creatingRef.current = false
      setLoading(false)
    }
  }, [
    conversationId,
    chatApi,
    onConversationCreated,
    queryClient,
    config.title,
  ])

  // Resolve-or-create the conversation, then stream the turn. The user bubble is
  // pushed optimistically (a `hidden` send skips the engine's own push) so it
  // shows immediately rather than after the create round-trip.
  const deliver = useCallback(
    async (content: string): Promise<void> => {
      const trimmed = content.trim()
      if (!trimmed) return
      setStreamError(null)
      lastSentRef.current = trimmed
      const id = await ensureConversationId()
      if (!id) {
        setStreamError('Could not start chat. Try again.')
        return
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `pending-${crypto.randomUUID()}`,
          conversationId: id,
          role: 'user',
          content: trimmed,
          createdAt: new Date().toISOString(),
        },
      ])
      await send(id, trimmed, { hidden: true })
    },
    [ensureConversationId, send, setMessages],
  )

  const onSend = useCallback((): void => {
    const text = composer.trim()
    if (!text || busy) return
    // Stop dictation on send so the mic doesn't keep transcribing into the
    // now-cleared composer after the message goes out.
    if (dictation.active) void dictation.stop()
    setComposer('')
    void deliver(text)
  }, [composer, busy, dictation, deliver])

  // Retry re-streams the last turn. On a stream error the user's message is
  // already in the transcript, so re-send hidden (no duplicate user bubble); an
  // init error left nothing behind, so fall back to the full deliver.
  const onRetry = useCallback((): void => {
    const text = lastSentRef.current
    if (!text) return
    setStreamError(null)
    if (conversationId) void send(conversationId, text, { hidden: true })
    else void deliver(text)
  }, [conversationId, send, deliver])

  const onFeedback = useCallback((id: string, value: 'up' | 'down' | '') => {
    // TODO: feedback is local-only and lost on close. Persist via the chat API
    // (e.g. chatApi.submitFeedback(messageId, value)) once the endpoint exists.
    setFeedback((prev) => ({ ...prev, [id]: value || undefined }))
  }, [])

  // Announce generation status on transitions only, so the whole streamed answer
  // isn't re-read on every token.
  const prevSendingRef = useRef(false)
  useEffect(() => {
    if (sending && !prevSendingRef.current) setLiveStatus('Generating response')
    else if (!sending && prevSendingRef.current)
      setLiveStatus(streamError ? '' : 'Response ready')
    prevSendingRef.current = sending
  }, [sending, streamError])

  const autoDictateStartedRef = useRef(false)
  useEffect(() => {
    if (!active) autoDictateStartedRef.current = false
  }, [active])
  useEffect(() => {
    if (!autoDictate || !active || autoDictateStartedRef.current) return
    if (dictation.status !== 'idle') return
    autoDictateStartedRef.current = true
    void dictation.start()
  }, [autoDictate, active, dictation.status, dictation.start, dictation])

  // ----- intro typing animation -----
  const introMessages = config.introMessages ?? []
  const introTotal = useMemo(
    () => introMessages.reduce((sum, m) => sum + m.length, 0),
    [introMessages],
  )
  const showIntroAnimation =
    introMessages.length > 0 &&
    !conversationIdOverride &&
    messages.length === 0 &&
    !sending &&
    visibleSegments.length === 0 &&
    !streamError

  useEffect(() => {
    if (!showIntroAnimation || introTotal === 0) return
    let seen = false
    try {
      seen = window.localStorage.getItem(config.introSeenKey) === '1'
    } catch {
      seen = false
    }
    if (seen) return

    const step = Math.max(2, Math.ceil(introTotal / 120))
    const id = setInterval(() => {
      setIntroProgress((p) => {
        const next = Math.min(p + step, introTotal)
        if (next >= introTotal) {
          clearInterval(id)
          try {
            window.localStorage.setItem(config.introSeenKey, '1')
          } catch {
            // private mode — still stream this session
          }
        }
        return next
      })
    }, 28)
    return () => clearInterval(id)
  }, [showIntroAnimation, introTotal, config.introSeenKey])

  const introParts = useMemo(() => {
    let remaining = introProgress
    const parts: string[] = []
    for (const message of introMessages) {
      if (remaining <= 0) break
      parts.push(message.slice(0, remaining))
      remaining -= message.length
    }
    return parts
  }, [introProgress, introMessages])

  // Project persisted turns once per history change (not on every reveal tick).
  const history = useMemo(
    () =>
      messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        live:
          m.role === 'user'
            ? null
            : segmentsToLive(m.segments ?? [], m.content),
      })),
    [messages],
  )

  const { scrollRef, onScroll } = usePinnedAutoScroll([
    messages,
    visibleSegments,
  ])

  const working = sending && visibleSegments.length === 0
  const suggestions = config.suggestions ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={
          className ??
          `mx-auto flex min-h-0 w-full ${CHAT_MAX_W} flex-1 flex-col gap-10 overflow-y-auto px-4 py-5`
        }
        data-testid="ai-chat-conversation"
      >
        {loading && messages.length === 0 && !sending && (
          <div className="text-sm text-muted-foreground">Loading chat...</div>
        )}

        {showIntroAnimation &&
          introParts.map((text, i) => (
            <div
              key={i}
              className="self-start max-w-full text-sm text-foreground"
            >
              {text}
            </div>
          ))}

        {history.map((m) =>
          m.live === null ? (
            <UserBubble key={m.id}>{m.content}</UserBubble>
          ) : (
            <AssistantRow key={m.id}>
              {messageRenderer ? (
                <div className={ASSISTANT_BUBBLE}>
                  {messageRenderer(m.content)}
                </div>
              ) : (
                <InlineSegments segments={m.live} toolLabel={toolLabel} />
              )}
              <ToggleGroup
                type="single"
                size="sm"
                value={feedback[m.id] ?? ''}
                onValueChange={(v) => onFeedback(m.id, v as 'up' | 'down' | '')}
                className="-ml-1 gap-1"
              >
                <ToggleGroupItem
                  value="up"
                  aria-label="Like this response"
                  className="size-7 flex-none rounded-full text-muted-foreground data-[state=on]:bg-transparent data-[state=on]:text-primary"
                >
                  <ThumbsUpIcon className="size-3" aria-hidden />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="down"
                  aria-label="Dislike this response"
                  className="size-7 flex-none rounded-full text-muted-foreground data-[state=on]:bg-transparent data-[state=on]:text-destructive"
                >
                  <ThumbsDownIcon className="size-3" aria-hidden />
                </ToggleGroupItem>
              </ToggleGroup>
            </AssistantRow>
          ),
        )}

        {visibleSegments.length > 0 ? (
          <AssistantRow>
            <InlineSegments segments={visibleSegments} toolLabel={toolLabel} />
          </AssistantRow>
        ) : null}

        {working ? <ThinkingRow /> : null}

        {/* Announce generation status once, instead of re-reading the whole
            streamed answer on every token. */}
        <span className="sr-only" aria-live="polite">
          {liveStatus}
        </span>

        {streamError && (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <span>{streamError}</span>
            <Button
              type="button"
              size="small"
              variant="outline"
              onClick={onRetry}
              disabled={busy}
            >
              Retry
            </Button>
          </div>
        )}
      </div>

      {/* Suggestion chips — only on a fresh chat. */}
      {suggestions.length > 0 &&
        messages.length === 0 &&
        !sending &&
        !streamError && (
          <div className="px-3 pb-3 pt-2">
            <div
              className={`mx-auto flex w-full ${CHAT_MAX_W} flex-col items-start gap-2`}
            >
              {suggestions.map((s) => (
                <Button
                  key={s}
                  type="button"
                  variant="outline"
                  size="small"
                  disabled={busy}
                  onClick={() => void deliver(s)}
                  className="rounded-full"
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}

      {/* Bottom slot — between messages and composer */}
      {bottomSlot && (
        <div>
          <div
            className={`mx-auto w-full ${CHAT_MAX_W} px-4 pt-3 pb-5 lg:px-6`}
          >
            {bottomSlot}
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-border px-3 py-3">
        <div className={`mx-auto w-full ${CHAT_MAX_W}`}>
          <ChatComposer
            value={composer}
            onChange={setComposer}
            onSubmit={onSend}
            disabled={busy}
            placeholder={config.placeholder ?? 'How can I help?'}
            dictation={dictation}
            leadingSlot={
              onSelectConversation ? (
                <AiChatHistoryPopover
                  chatApi={chatApi}
                  configTitle={config.title}
                  onSelect={onSelectConversation}
                />
              ) : undefined
            }
          />
        </div>
      </div>
    </div>
  )
}
