'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Badge, Button } from '@styleguide'
import {
  ASSISTANT_BUBBLE,
  AssistantMarkdown,
  AssistantRow,
  ChatComposer,
  InlineSegments,
  ThinkingRow,
  UserBubble,
} from '../../../shared/agent-chat/chatUI'
import { segmentsToLive } from '../../../shared/agent-chat/streaming'
import { useStreamingTurn } from '../../../shared/agent-chat/useStreamingTurn'
import { usePinnedAutoScroll } from '../../../shared/agent-chat/usePinnedAutoScroll'
import { useDictationAppend } from '../../../briefings/shared/useDictationAppend'
import { reportErrorToSentry } from '@shared/sentry'
import { chiefOfStaffChatApi } from '../../data/chat-api'
import type {
  AgentChatClient,
  ChatMessageDto,
} from '../../../shared/agent-chat/chatClient'
import { COS_INTRO_MESSAGES, toolDisplayName } from './chatConstants'
import ChatHistoryPopover from './ChatHistoryPopover'
import { HISTORY_KEY, useChatHistory } from '../../data/use-chat-history'

interface Props {
  /**
   * Reopen an existing conversation: skip deferred-create and replay its
   * prior messages. Omit for a fresh chat (deferred create on first send).
   */
  conversationIdOverride?: string
  /**
   * Display-only assistant messages played on open (e.g. an onboarding card's
   * agent greeting). Always shown; bypasses the first-chat-only intro gate.
   */
  opener?: string[]
  /** When the parent surface closes, set false to gate first-chat/kickoff logic. */
  active?: boolean
  /** Fires once the deferred create resolves with the real conversation id. */
  onConversationCreated?: (conversationId: string) => void
  /** Open a past conversation picked from the input pill's history popover. */
  onSelectConversation?: (conversationId: string) => void
  bodyClassName?: string
  /**
   * Scope config. All default to Chief of Staff so existing CoS/Community
   * Issues callers are unchanged; Campaign Manager passes its own.
   */
  chatApi?: AgentChatClient
  analyticsLabel?: string
  historyKey?: readonly unknown[]
  /** Default intro played on the first chat when no `opener` is given. */
  defaultIntro?: string[]
  /**
   * Starter chips. Each carries its own behavior via `onSelect`. Omit to get
   * the Chief of Staff defaults (send the chip's label as a message).
   */
  suggestions?: ChatSuggestion[]
  /**
   * Render the starter chips alongside a seeded/played greeting, not only on
   * an empty transcript. Defaults to false, so CoS/Community Issues still show
   * chips only before the first turn.
   */
  showSuggestionsWithGreeting?: boolean
  /**
   * Short quick-prompt pills shown below the suggestions (above the composer),
   * each sending its own text as a visible message. Distinct from `suggestions`
   * (the larger action cards). Omit for CoS / Community Issues.
   */
  quickPrompts?: string[]
  /** Composer placeholder. Defaults to the generic "How can I help?". */
  composerPlaceholder?: string
  /**
   * One-shot kickoff: send this message once on open through the normal stream
   * path but WITHOUT an optimistic user bubble (the server hides it / returns
   * a canned reply). Consumed once per mount.
   */
  pendingKickoff?: string
  /** Ref to the composer input, so a caller's suggestion can focus it. */
  composerRef?: RefObject<HTMLTextAreaElement | null>
  /**
   * Fine-print line under the composer, e.g. "<Agent> can make mistakes. Check
   * important details." Omit to render nothing.
   */
  disclaimer?: string
  /**
   * Message contents to drop from a rendered transcript, matched by exact
   * content regardless of role: the sentinel USER turns that only keep the
   * server history alternating (their assistant reply still renders), and a
   * seeded ASSISTANT greeting that a kickoff's own reply supersedes (the story
   * entry passes the general greeting so the manager doesn't double-greet).
   * Default empty: no filtering.
   */
  hiddenMessageContents?: string[]
}

/**
 * A starter chip. `kickoff` fires an on-demand hidden send of that string
 * (no user bubble); otherwise `onSelect` runs. `description` renders a
 * secondary line beneath the label.
 */
export type ChatSuggestion = {
  label: string
  description?: string
  onSelect?: () => void
  kickoff?: string
}

const INTRO_SEEN_KEY = 'cos-intro-streamed'

// Stable default so callers that omit the prop keep the same array identity
// across renders (no needless re-run of the load effect).
const NO_HIDDEN_CONTENTS: string[] = []

// Starter prompts shown on a fresh chat; tapping one sends it.
const CHAT_SUGGESTIONS = [
  "What's most urgent this week?",
  'How many of my constituents are homeowners?',
  'What are constituents saying?',
]

/**
 * The reusable Chief of Staff chat surface body — separate from the briefing
 * `AskAiChatBody`. Streaming, smooth reveal, inline tool pills, and the
 * persisted-history handoff come from the shared agent-chat kit
 * (useStreamingTurn + chatUI); this component adds the CoS chrome: a typed
 * intro on first open, a typed-in seeded greeting, deferred conversation
 * creation, hidden kickoffs, starter chips, and quick prompts.
 */
export default function ChiefOfStaffChatBody({
  conversationIdOverride,
  opener,
  active = true,
  onConversationCreated,
  onSelectConversation,
  bodyClassName,
  chatApi = chiefOfStaffChatApi,
  analyticsLabel = 'chief-of-staff-chat',
  historyKey = HISTORY_KEY,
  defaultIntro = COS_INTRO_MESSAGES,
  suggestions,
  showSuggestionsWithGreeting = false,
  quickPrompts,
  composerPlaceholder = 'How can I help?',
  pendingKickoff,
  composerRef,
  disclaimer,
  hiddenMessageContents = NO_HIDDEN_CONTENTS,
}: Props): React.JSX.Element {
  const queryClient = useQueryClient()
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [composer, setComposer] = useState('')
  const dictation = useDictationAppend({
    value: composer,
    onChange: setComposer,
    analyticsLabel,
  })
  const [loading, setLoading] = useState(false)
  const [streamError, setStreamError] = useState<{
    message: string
    retryable: boolean
  } | null>(null)
  const [introProgress, setIntroProgress] = useState(0)
  // True once anything has been sent this session (visible OR hidden). Gates the
  // with-greeting starter chips off after a hidden kickoff (which adds no user
  // turn).
  const [hasSent, setHasSent] = useState(false)
  // Contents sent hidden this session; their persisted user turn is dropped from
  // the rendered transcript (the engine reconciles against the raw server
  // transcript, which includes the hidden turn).
  const [hiddenSent, setHiddenSent] = useState<string[]>([])
  // A reloaded assistant-only transcript (a server-seeded greeting) is typed in
  // on open instead of dumped, then committed to the engine's messages.
  const [playback, setPlayback] = useState<{
    items: ChatMessageDto[]
    progress: number
  } | null>(null)

  const creatingRef = useRef(false)
  const loadRequestedRef = useRef(false)
  const lastUserContentRef = useRef('')
  // Tracks the pendingKickoff value that has already fired (not a boolean): the
  // parent clears pendingKickoff on close and re-sets the same sentinel on
  // reopen with the body still mounted, so a value guard lets that reopen fire.
  const kickedOffRef = useRef<string | undefined>(undefined)
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null)
  const assignComposerRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      composerInputRef.current = node
      if (composerRef) composerRef.current = node
    },
    [composerRef],
  )

  const toolLabel = useCallback(
    (name: string): string => toolDisplayName(name),
    [],
  )

  const { messages, setMessages, visibleSegments, sending, send } =
    useStreamingTurn(chatApi, {
      toolLabel,
      onTurnStart: () => setStreamError(null),
      onError: (message, retryable) => setStreamError({ message, retryable }),
    })

  const busy = sending || loading

  // Contents whose persisted USER turn is hidden from the transcript: the
  // caller's reload sentinels plus anything sent hidden this session.
  const hiddenContentSet = useMemo(
    () => new Set([...hiddenMessageContents, ...hiddenSent]),
    [hiddenMessageContents, hiddenSent],
  )
  const visibleMessages = useMemo(
    () => messages.filter((m) => !hiddenContentSet.has(m.content)),
    [messages, hiddenContentSet],
  )

  // The intro plays only on the user's first chat (they have no prior
  // conversations) and only once ever (a localStorage flag), typing in character
  // by character. An onboarding-card opener bypasses both gates.
  const { data: priorConversations } = useChatHistory(
    active && !conversationIdOverride,
    chatApi,
    historyKey,
  )
  const isFirstChat =
    !conversationIdOverride &&
    priorConversations !== undefined &&
    priorConversations.length === 0

  const introMessages = opener ?? defaultIntro
  const introTotal = useMemo(
    () => introMessages.reduce((sum, m) => sum + m.length, 0),
    [introMessages],
  )

  useEffect(() => {
    const isOpener = opener !== undefined
    if (!isOpener && !isFirstChat) return
    if (!isOpener) {
      let seen = false
      try {
        seen = window.localStorage.getItem(INTRO_SEEN_KEY) === '1'
      } catch {
        seen = false
      }
      if (seen) return
    }

    const step = Math.max(2, Math.ceil(introTotal / 120))
    const id = setInterval(() => {
      if (!isOpener) {
        try {
          window.localStorage.setItem(INTRO_SEEN_KEY, '1')
        } catch {
          // private mode / storage disabled — still stream this session
        }
      }
      setIntroProgress((p) => {
        const next = Math.min(p + step, introTotal)
        if (next >= introTotal) clearInterval(id)
        return next
      })
    }, 28)
    return () => clearInterval(id)
  }, [opener, isFirstChat, introTotal])

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

  // Type the seeded-greeting playback in with the same pacing as the intro.
  const playbackActive = playback !== null
  useEffect(() => {
    if (!playbackActive) return
    const id = setInterval(() => {
      setPlayback((p) => {
        if (!p) return p
        const total = p.items.reduce((sum, it) => sum + it.content.length, 0)
        const step = Math.max(2, Math.ceil(total / 120))
        const next = Math.min(p.progress + step, total)
        return next === p.progress ? p : { ...p, progress: next }
      })
    }, 28)
    return () => clearInterval(id)
  }, [playbackActive])

  // Once fully typed, the played-back transcript becomes regular history.
  useEffect(() => {
    if (!playback) return
    const total = playback.items.reduce((sum, it) => sum + it.content.length, 0)
    if (playback.progress < total) return
    const items = playback.items
    setMessages((prev) => (prev.length === 0 ? items : prev))
    setPlayback(null)
  }, [playback, setMessages])

  const playbackParts = useMemo(() => {
    if (!playback) return []
    let remaining = playback.progress
    const parts: string[] = []
    for (const it of playback.items) {
      if (remaining <= 0) break
      parts.push(it.content.slice(0, remaining))
      remaining -= it.content.length
    }
    return parts
  }, [playback])

  // Override path — replay an existing conversation's messages once on mount.
  const loadExisting = useCallback(async () => {
    if (!conversationIdOverride) return
    if (loadRequestedRef.current) return
    loadRequestedRef.current = true
    setLoading(true)
    setConversationId(conversationIdOverride)
    try {
      const msgs = await chatApi.listMessages(conversationIdOverride)
      // A transcript whose only VISIBLE turns are assistant messages (no user
      // turn — the server-seeded greeting) is typed in like a live reply instead
      // of dumped. Sentinel user turns are hidden but their replies count as
      // visible; segment-bearing turns render structured blocks the plain typed
      // playback can't, so those always dump.
      const visible = msgs.filter((m) => !hiddenContentSet.has(m.content))
      const playable =
        visible.length > 0 &&
        visible.every(
          (m) => m.role === 'assistant' && !(m.segments ?? []).length,
        )
      if (playable) {
        setPlayback({ items: visible, progress: 0 })
      } else {
        setMessages(msgs)
      }
    } catch (err) {
      reportErrorToSentry(err, {
        surface: 'chief-of-staff-chat',
        phase: 'init',
        conversationIdOverride,
      })
      loadRequestedRef.current = false
      setStreamError({
        message: 'Could not load this chat. Try again.',
        retryable: true,
      })
    } finally {
      setLoading(false)
    }
    // hiddenContentSet is read for the initial playable check only; it is stable
    // for a given conversation load and intentionally not a dependency (a later
    // hidden send must not re-run the load).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationIdOverride, chatApi, setMessages])

  useEffect(() => {
    if (!active) return
    if (!conversationIdOverride) return
    void loadExisting()
  }, [active, conversationIdOverride, loadExisting])

  // Deferred create — return the existing id or mint a new conversation.
  const ensureConversationId = useCallback(async (): Promise<string | null> => {
    if (conversationId) return conversationId
    if (creatingRef.current) return null
    creatingRef.current = true
    setLoading(true)
    try {
      const { conversationId: id } = await chatApi.createConversation()
      setConversationId(id)
      onConversationCreated?.(id)
      // Surface the new conversation in the history list right away.
      void queryClient.invalidateQueries({ queryKey: historyKey })
      return id
    } catch (err) {
      reportErrorToSentry(err, {
        surface: 'chief-of-staff-chat',
        phase: 'init',
      })
      return null
    } finally {
      creatingRef.current = false
      setLoading(false)
    }
  }, [conversationId, chatApi, onConversationCreated, queryClient, historyKey])

  // The shared send path. `hidden` skips the optimistic user bubble AND drops
  // the persisted user turn from the rendered transcript, so a kickoff streams a
  // reply without ever showing the prompt that triggered it.
  const deliver = useCallback(
    async (content: string, opts?: { hidden?: boolean }): Promise<boolean> => {
      const trimmed = content.trim()
      if (!trimmed || sending || creatingRef.current) return false
      setStreamError(null)
      setHasSent(true)
      // A send mid-playback flushes the rest of the greeting into history so the
      // transcript stays ordered ahead of the user's message.
      if (playback) {
        const items = playback.items
        setPlayback(null)
        setMessages((prev) => (prev.length === 0 ? items : prev))
      }
      if (opts?.hidden) {
        setHiddenSent((prev) =>
          prev.includes(trimmed) ? prev : [...prev, trimmed],
        )
      } else {
        lastUserContentRef.current = trimmed
      }
      const id = await ensureConversationId()
      if (!id) {
        setStreamError({
          message: 'Could not start chat. Try again.',
          retryable: true,
        })
        return false
      }
      if (!opts?.hidden) {
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
      }
      await send(id, trimmed, { hidden: true })
      return true
    },
    [sending, playback, ensureConversationId, send, setMessages],
  )

  const sendContent = useCallback(
    (content: string) => deliver(content, { hidden: false }),
    [deliver],
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
    if (content && conversationId) {
      void send(conversationId, content, { hidden: true })
      return
    }
    if (content) {
      void deliver(content, { hidden: false })
      return
    }
    // No user turn to replay — a load error. Reload the conversation.
    loadRequestedRef.current = false
    void loadExisting()
  }, [conversationId, send, deliver, loadExisting])

  // Fire the one-shot kickoff once the surface is open and any load/create has
  // settled, so it appends to the resolved conversation rather than racing a
  // fresh create.
  useEffect(() => {
    if (!pendingKickoff) {
      kickedOffRef.current = undefined
      return
    }
    if (!active || kickedOffRef.current === pendingKickoff) return
    // Wait out an in-flight stream: a close/reopen can re-set the same kickoff
    // while the prior turn is still draining. Firing now would bail inside
    // `deliver` (its own `sending` guard) yet still latch `kickedOffRef` below,
    // so the retry after the stream settles would be skipped. Returning here
    // leaves the ref unlatched; the effect re-runs when `sending` clears.
    if (loading || creatingRef.current || sending) return
    if (conversationIdOverride && conversationId !== conversationIdOverride) {
      return
    }
    kickedOffRef.current = pendingKickoff
    void deliver(pendingKickoff, { hidden: true })
  }, [
    active,
    pendingKickoff,
    loading,
    sending,
    conversationId,
    conversationIdOverride,
    deliver,
  ])

  // A chip with `kickoff` fires an on-demand hidden send; otherwise it defers to
  // the chip's own `onSelect`.
  const onSuggestionClick = useCallback(
    (s: ChatSuggestion) => {
      if (s.kickoff) {
        void deliver(s.kickoff, { hidden: true })
        return
      }
      s.onSelect?.()
    },
    [deliver],
  )

  // Return focus to the composer once a turn finishes and it re-enables, so the
  // candidate can keep chatting without clicking back in.
  const prevBusyRef = useRef(busy)
  useEffect(() => {
    const wasBusy = prevBusyRef.current
    prevBusyRef.current = busy
    if (wasBusy && !busy && active !== false) {
      composerInputRef.current?.focus()
    }
  }, [busy, active])

  const { scrollRef, onScroll } = usePinnedAutoScroll([
    visibleMessages,
    visibleSegments,
    playback,
  ])

  const working = sending && visibleSegments.length === 0

  const history = useMemo(
    () =>
      visibleMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        live:
          m.role === 'user'
            ? null
            : segmentsToLive(m.segments ?? [], m.content),
      })),
    [visibleMessages],
  )

  // Starter chips: the caller's list, or the CoS defaults that send the chip's
  // own label as a message.
  const effectiveSuggestions = useMemo<ChatSuggestion[]>(
    () =>
      suggestions ??
      CHAT_SUGGESTIONS.map((label) => ({
        label,
        onSelect: () => void sendContent(label),
      })),
    [suggestions, sendContent],
  )

  const showIntro =
    (opener !== undefined || isFirstChat) &&
    visibleMessages.length === 0 &&
    !sending &&
    visibleSegments.length === 0 &&
    !playback &&
    !streamError

  // The with-greeting chips show only while the conversation is pristine:
  // nothing sent this session and the transcript is at most the single seeded
  // greeting (still playing back, or just committed).
  const isPristineGreeting =
    !hasSent && visibleMessages.length + (playback?.items.length ?? 0) <= 1

  const showStarters =
    ((visibleMessages.length === 0 && !playback) ||
      (showSuggestionsWithGreeting && isPristineGreeting)) &&
    !sending &&
    !streamError
  const suggestionsAsCards = effectiveSuggestions.some((s) =>
    Boolean(s.description),
  )

  return (
    // vaul disables text selection on the drawer and pointer-captures on
    // pointerdown, which cancels drag-selection spanning more than one element.
    // select-text restores the CSS; releasing the capture restores the drag. The
    // release is queued because vaul sets the capture from an ancestor handler
    // that runs after this one. Do NOT stopPropagation: Radix dismisses popovers
    // from a document-level pointerdown, so that would strand the history popover.
    <div
      className="flex min-h-0 flex-1 flex-col select-text"
      data-vaul-no-drag
      onPointerDown={(e) => {
        const target = e.target
        if (!(target instanceof Element)) return
        const { pointerId } = e
        queueMicrotask(() => {
          if (target.hasPointerCapture(pointerId)) {
            target.releasePointerCapture(pointerId)
          }
        })
      }}
    >
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={
          bodyClassName ??
          'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3'
        }
        data-testid="cos-conversation"
      >
        {loading && visibleMessages.length === 0 && !sending && (
          <div className="text-sm text-muted-foreground">Loading chat...</div>
        )}

        {showIntro &&
          introParts.map((text, i) => (
            <AssistantRow key={`intro-${i}`}>
              <div className={ASSISTANT_BUBBLE}>{text}</div>
            </AssistantRow>
          ))}

        {playbackParts.map((text, i) => (
          <AssistantRow key={`pb-${i}`}>
            <AssistantMarkdown>{text}</AssistantMarkdown>
          </AssistantRow>
        ))}

        {history.map((m) =>
          m.live === null ? (
            <UserBubble key={m.id}>{m.content}</UserBubble>
          ) : (
            <AssistantRow key={m.id}>
              <InlineSegments segments={m.live} toolLabel={toolLabel} />
            </AssistantRow>
          ),
        )}

        {visibleSegments.length > 0 ? (
          <AssistantRow>
            <InlineSegments segments={visibleSegments} toolLabel={toolLabel} />
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

      {showStarters && (
        <div
          className={
            suggestionsAsCards
              ? 'mx-auto flex w-full max-w-[608px] flex-col gap-2 px-3 pb-1 pt-2'
              : 'mx-auto flex w-full max-w-[608px] flex-wrap gap-2 px-3 pb-1 pt-2'
          }
        >
          {effectiveSuggestions.map((s) =>
            suggestionsAsCards ? (
              <button
                key={s.label}
                type="button"
                disabled={busy}
                onClick={() => onSuggestionClick(s)}
                className="w-full rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-grayscale-50 disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="block text-sm font-semibold text-foreground">
                  {s.label}
                </span>
                {s.description && (
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    {s.description}
                  </span>
                )}
              </button>
            ) : (
              <Badge
                key={s.label}
                asChild
                variant="soft"
                shape="pill"
                className="h-auto border-border bg-grayscale-50 px-3 py-1.5 disabled:pointer-events-none disabled:opacity-50"
              >
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSuggestionClick(s)}
                >
                  {s.label}
                </button>
              </Badge>
            ),
          )}
        </div>
      )}

      <div className="border-t border-border px-3 py-3">
        {quickPrompts && quickPrompts.length > 0 && showStarters && (
          <div className="mx-auto mb-3 flex w-full max-w-[608px] flex-wrap gap-2">
            {quickPrompts.map((prompt) => (
              <Badge
                key={prompt}
                asChild
                variant="soft"
                shape="pill"
                className="h-auto border-border bg-grayscale-50 px-3 py-1.5 disabled:pointer-events-none disabled:opacity-50"
              >
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void sendContent(prompt)}
                >
                  {prompt}
                </button>
              </Badge>
            ))}
          </div>
        )}
        <div className="mx-auto w-full max-w-[608px]">
          <ChatComposer
            value={composer}
            onChange={setComposer}
            onSubmit={onSend}
            disabled={busy}
            placeholder={composerPlaceholder}
            ariaLabel="Ask a question"
            inputRef={assignComposerRef}
            dictation={dictation}
            leadingSlot={
              onSelectConversation ? (
                <ChatHistoryPopover
                  onSelect={onSelectConversation}
                  chatApi={chatApi}
                  historyKey={historyKey}
                />
              ) : undefined
            }
          />
        </div>
        {disclaimer && (
          <p className="mx-auto mt-2 w-full max-w-[608px] text-center text-[11px] text-muted-foreground">
            {disclaimer}
          </p>
        )}
      </div>
    </div>
  )
}
