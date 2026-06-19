'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Button,
  IconButton,
  Input,
  Loader2Icon,
  MicIcon,
  SquareIcon,
} from '@styleguide'
import { SearchIcon, SparklesIcon } from '@styleguide/components/ui/icons'
import { useDictationAppend } from '../../../briefings/shared/useDictationAppend'
import { reportErrorToSentry } from '@shared/sentry'
import { chiefOfStaffChatApi as chatApi } from '../../data/chat-api'
import type {
  ChatErrorCode,
  ChatMessageDto,
  ChatStreamEvent,
} from '../../data/contracts'
import { COS_INTRO_MESSAGES, toolDisplayName } from './chatConstants'
import ChatHistoryPopover from './ChatHistoryPopover'
import { HISTORY_KEY, useChatHistory } from '../../data/use-chat-history'

interface Props {
  /**
   * Reopen an existing conversation: skip deferred-create and replay its
   * prior messages. Omit for a fresh chat (deferred create on first send).
   */
  conversationIdOverride?: string
  /** When the parent surface closes, set false to abort the in-flight stream. */
  active?: boolean
  /** Fires once the deferred create resolves with the real conversation id. */
  onConversationCreated?: (conversationId: string) => void
  /** Open a past conversation picked from the input pill's history popover. */
  onSelectConversation?: (conversationId: string) => void
  bodyClassName?: string
}

type ChatItem =
  | { kind: 'user'; id: string; content: string }
  | { kind: 'assistant'; id: string; content: string; toolsUsed?: string[] }

type ErrorState = {
  message: string
  retryable: boolean
  lastUserContent: string
  lastClientMessageId: string
  kind: 'init' | 'stream'
}

const FRIENDLY_ERROR_COPY: Record<ChatErrorCode, string> = {
  rate_limited: 'Too many requests. Try again in a moment.',
  upstream_unavailable: 'Chat is temporarily unavailable. Try again.',
  aborted: '',
  conversation_not_found:
    'This chat is no longer available. Try starting a new one.',
  internal: 'Something went wrong. Try again.',
}

function friendlyErrorMessage(code: ChatErrorCode): string {
  return FRIENDLY_ERROR_COPY[code] ?? 'Something went wrong. Try again.'
}

function newClientMessageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `cmid_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

function messageToItem(msg: ChatMessageDto): ChatItem | null {
  if (msg.role === 'user') {
    return { kind: 'user', id: msg.id, content: msg.content }
  }
  if (msg.role === 'assistant') {
    return { kind: 'assistant', id: msg.id, content: msg.content }
  }
  return null
}

const INTRO_SEEN_KEY = 'cos-intro-streamed'

// Starter prompts shown on a fresh chat; tapping one sends it.
const CHAT_SUGGESTIONS = [
  "What's most urgent this week?",
  'Where do I stand on housing?',
  'What are constituents saying?',
]

// Markdown rendered inside a chat bubble inherits flex/whitespace from the
// message layout, which breaks <p>/<strong>/<a> onto their own lines. The
// !block / !inline / !whitespace-normal overrides neutralize that (same set
// the briefing chat uses) so prose, lists, headings and tables render cleanly.
const ASSISTANT_BUBBLE =
  'self-start max-w-full rounded-2xl bg-muted px-3 py-2 text-sm text-foreground ' +
  'space-y-2 [&>:first-child]:mt-0 [&>:last-child]:mb-0 ' +
  '[&_p]:!block [&_p]:!flex-none [&_p]:!whitespace-normal ' +
  '[&_strong]:!inline [&_strong]:font-semibold [&_em]:!inline [&_em]:italic ' +
  '[&_a]:!inline [&_a]:underline [&_code]:!inline [&_code]:rounded ' +
  '[&_code]:bg-foreground/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs ' +
  '[&_li]:!list-item [&_li]:my-0 [&_ul]:!block [&_ul]:list-disc [&_ul]:pl-5 ' +
  '[&_ul]:space-y-1 [&_ol]:!block [&_ol]:list-decimal [&_ol]:pl-5 ' +
  '[&_ol]:space-y-1 [&_h1]:!block [&_h1]:text-base [&_h1]:font-semibold ' +
  '[&_h2]:!block [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:!block ' +
  '[&_h3]:text-sm [&_h3]:font-semibold [&_table]:!table [&_table]:!w-full ' +
  '[&_table]:!border-collapse [&_table]:my-2 [&_thead]:!table-header-group ' +
  '[&_tbody]:!table-row-group [&_tr]:!table-row [&_tr]:!border-b ' +
  '[&_tr]:border-foreground/15 [&_th]:!table-cell [&_th]:px-2 [&_th]:py-1.5 ' +
  '[&_th]:text-left [&_th]:font-semibold [&_th]:!border-b-2 ' +
  '[&_th]:!border-foreground/30 [&_td]:!table-cell [&_td]:px-2 [&_td]:py-1.5 ' +
  '[&_td]:align-top'

/**
 * The reusable Chief of Staff chat surface body — separate from the briefing
 * `AskAiChatBody`. Plays hard-coded intro messages on first open, defers
 * conversation creation until the first send (so opening + closing an empty
 * chat creates nothing), renders tool calls as status lines, and streams the
 * assistant response over SSE.
 */
export default function ChiefOfStaffChatBody({
  conversationIdOverride,
  active = true,
  onConversationCreated,
  onSelectConversation,
  bodyClassName,
}: Props): React.JSX.Element {
  const queryClient = useQueryClient()
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [history, setHistory] = useState<ChatItem[]>([])
  const [streaming, setStreaming] = useState<string | null>(null)
  const [activeTools, setActiveTools] = useState<string[]>([])
  const [composer, setComposer] = useState('')
  const dictation = useDictationAppend({
    value: composer,
    onChange: setComposer,
    analyticsLabel: 'chief-of-staff-chat',
  })
  const [error, setError] = useState<ErrorState | null>(null)
  const [creating, setCreating] = useState(false)
  const [sending, setSending] = useState(false)
  const [introProgress, setIntroProgress] = useState(0)

  const abortRef = useRef<AbortController | null>(null)
  const loadRequestedRef = useRef(false)
  const creatingRef = useRef(false)
  const sendingRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // The intro only plays on the user's first chat — they have no prior
  // conversations — and only once ever (a localStorage flag), typing the
  // messages in character by character like a streamed assistant reply.
  const { data: priorConversations } = useChatHistory(
    active && !conversationIdOverride,
  )
  const isFirstChat =
    !conversationIdOverride &&
    priorConversations !== undefined &&
    priorConversations.length === 0

  const introTotal = useMemo(
    () => COS_INTRO_MESSAGES.reduce((sum, m) => sum + m.length, 0),
    [],
  )

  // Type the intro in with a single counter + interval. A counter is
  // StrictMode-safe (the discarded first mount only advances it; no duplicate
  // bubbles or interleaved chains like a recursive setTimeout closure).
  useEffect(() => {
    if (!isFirstChat) return
    let seen = false
    try {
      seen = window.localStorage.getItem(INTRO_SEEN_KEY) === '1'
    } catch {
      seen = false
    }
    if (seen) return

    const step = Math.max(2, Math.ceil(introTotal / 120))
    const id = setInterval(() => {
      // Mark seen once typing actually begins — set here, not at effect entry,
      // so StrictMode's discarded first mount (whose interval is cleared
      // before it ticks) doesn't suppress the real run.
      try {
        window.localStorage.setItem(INTRO_SEEN_KEY, '1')
      } catch {
        // private mode / storage disabled — still stream this session
      }
      setIntroProgress((p) => {
        const next = Math.min(p + step, introTotal)
        if (next >= introTotal) clearInterval(id)
        return next
      })
    }, 28)
    return () => clearInterval(id)
  }, [isFirstChat, introTotal])

  // Per-message visible slices derived from the single progress counter.
  const introParts = useMemo(() => {
    let remaining = introProgress
    const parts: string[] = []
    for (const message of COS_INTRO_MESSAGES) {
      if (remaining <= 0) break
      parts.push(message.slice(0, remaining))
      remaining -= message.length
    }
    return parts
  }, [introProgress])

  // Override path — replay an existing conversation's messages once on mount.
  const loadExisting = useCallback(async () => {
    if (!conversationIdOverride) return
    if (loadRequestedRef.current) return
    loadRequestedRef.current = true
    setCreating(true)
    try {
      setConversationId(conversationIdOverride)
      const msgs = await chatApi.listMessages(conversationIdOverride)
      const items: ChatItem[] = []
      for (const m of msgs) {
        const it = messageToItem(m)
        if (it) items.push(it)
      }
      setHistory(items)
    } catch (err) {
      reportErrorToSentry(err, {
        surface: 'chief-of-staff-chat',
        phase: 'init',
        conversationIdOverride,
      })
      loadRequestedRef.current = false
      setError({
        message: 'Could not load this chat. Try again.',
        retryable: true,
        lastUserContent: '',
        lastClientMessageId: '',
        kind: 'init',
      })
    } finally {
      setCreating(false)
    }
  }, [conversationIdOverride])

  useEffect(() => {
    if (!active) return
    if (!conversationIdOverride) return
    void loadExisting()
  }, [active, conversationIdOverride, loadExisting])

  // Abort the in-flight stream when the surface closes or unmounts.
  useEffect(() => {
    if (active) return
    abortRef.current?.abort()
    abortRef.current = null
    sendingRef.current = false
    setSending(false)
  }, [active])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  // Follow the latest content.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [streaming, history.length])

  // Deferred create — return the existing id or mint a new conversation.
  const ensureConversationId = useCallback(async (): Promise<string | null> => {
    if (conversationId) return conversationId
    if (creatingRef.current) return null
    creatingRef.current = true
    setCreating(true)
    try {
      const { conversationId: id } = await chatApi.createConversation()
      setConversationId(id)
      onConversationCreated?.(id)
      // Surface the new conversation in the history list right away — the cache
      // is otherwise only refreshed on delete, so a fresh chat wouldn't appear
      // until a later refetch.
      void queryClient.invalidateQueries({ queryKey: HISTORY_KEY })
      return id
    } catch (err) {
      reportErrorToSentry(err, {
        surface: 'chief-of-staff-chat',
        phase: 'init',
      })
      return null
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }, [conversationId, onConversationCreated, queryClient])

  const runStream = useCallback(
    async (targetId: string, content: string, clientMessageId: string) => {
      const controller = new AbortController()
      abortRef.current = controller
      sendingRef.current = true
      setSending(true)
      setStreaming('')
      setActiveTools([])
      setError(null)

      try {
        const iter = chatApi.streamMessage({
          conversationId: targetId,
          content,
          clientMessageId,
          signal: controller.signal,
        })
        let assembled = ''
        let assistantId: string | undefined
        let errored: ChatStreamEvent | null = null
        const turnTools: string[] = []
        // Text before and after a tool call comes from separate model steps,
        // so the boundary has no whitespace ("...now." + "You..."). Insert a
        // paragraph break when text resumes after a tool call.
        let breakBeforeNextText = false

        for await (const ev of iter) {
          if (ev.type === 'text') {
            if (
              breakBeforeNextText &&
              assembled.length > 0 &&
              !/\s$/.test(assembled) &&
              !/^\s/.test(ev.delta)
            ) {
              assembled += '\n\n'
            }
            breakBeforeNextText = false
            assembled += ev.delta
            setStreaming(assembled)
          } else if (ev.type === 'tool_call') {
            if (assembled.length > 0) breakBeforeNextText = true
            if (!turnTools.includes(ev.toolName)) {
              turnTools.push(ev.toolName)
              setActiveTools([...turnTools])
            }
          } else if (ev.type === 'done') {
            assistantId = ev.assistantMessageId
            break
          } else if (ev.type === 'error') {
            errored = ev
            break
          }
        }

        if (errored && errored.type === 'error') {
          if (errored.code === 'aborted') {
            setStreaming(null)
          } else {
            setError({
              message: friendlyErrorMessage(errored.code),
              retryable: errored.retryable,
              lastUserContent: content,
              lastClientMessageId: clientMessageId,
              kind: 'stream',
            })
            setStreaming(null)
          }
        } else {
          setHistory((prev) => [
            ...prev,
            {
              kind: 'assistant',
              id: assistantId ?? `local_assistant_${clientMessageId}`,
              content: assembled,
              ...(turnTools.length > 0 && { toolsUsed: [...turnTools] }),
            },
          ])
          setStreaming(null)
        }
      } catch (err) {
        reportErrorToSentry(err, {
          surface: 'chief-of-staff-chat',
          phase: 'stream',
          conversationId: targetId,
        })
        setError({
          message: 'Stream interrupted. Try again.',
          retryable: true,
          lastUserContent: content,
          lastClientMessageId: clientMessageId,
          kind: 'stream',
        })
        setStreaming(null)
      } finally {
        sendingRef.current = false
        setSending(false)
        setActiveTools([])
        abortRef.current = null
      }
    },
    [],
  )

  const executeUserTurn = useCallback(
    async (content: string, clientMessageId: string) => {
      setSending(true)
      setStreaming('')
      let id = conversationId
      if (!id) {
        id = await ensureConversationId()
        if (!id) {
          setError({
            message: 'Could not start chat. Try again.',
            retryable: true,
            lastUserContent: content,
            lastClientMessageId: clientMessageId,
            kind: 'init',
          })
          setStreaming(null)
          setSending(false)
          sendingRef.current = false
          return
        }
      }
      await runStream(id, content, clientMessageId)
    },
    [conversationId, ensureConversationId, runStream],
  )

  const sendContent = useCallback(
    async (content: string) => {
      const trimmed = content.trim()
      if (!trimmed) return false
      if (sendingRef.current || creatingRef.current) return false
      sendingRef.current = true
      const clientMessageId = newClientMessageId()
      setHistory((prev) => [
        ...prev,
        { kind: 'user', id: `local_${clientMessageId}`, content: trimmed },
      ])
      await executeUserTurn(trimmed, clientMessageId)
      return true
    },
    [executeUserTurn],
  )

  const onSend = useCallback(async () => {
    const sent = await sendContent(composer)
    if (sent) setComposer('')
  }, [composer, sendContent])

  const onRetry = useCallback(async () => {
    if (!error) return
    const { lastUserContent, lastClientMessageId } = error
    setError(null)
    if (!lastUserContent || !lastClientMessageId) {
      loadRequestedRef.current = false
      await loadExisting()
      return
    }
    await executeUserTurn(lastUserContent, lastClientMessageId)
  }, [error, executeUserTurn, loadExisting])

  const busy = sending || creating
  const showIntro = isFirstChat && history.length === 0 && !streaming && !error

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className={
          bodyClassName ??
          'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3'
        }
        data-testid="cos-conversation"
      >
        {creating && history.length === 0 && !streaming && (
          <div className="text-sm text-muted-foreground">Loading chat...</div>
        )}

        {showIntro &&
          introParts.map((text, i) => (
            <div
              key={i}
              className="flex max-w-full items-start gap-2 self-start"
            >
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <SparklesIcon className="size-3.5" aria-hidden />
              </span>
              <div className={ASSISTANT_BUBBLE}>{text}</div>
            </div>
          ))}

        {history.map((item) =>
          item.kind === 'user' ? (
            <div
              key={item.id}
              className="self-end rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground"
            >
              {item.content}
            </div>
          ) : (
            <div
              key={item.id}
              className="flex max-w-full items-start gap-2 self-start"
            >
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <SparklesIcon className="size-3.5" aria-hidden />
              </span>
              <div className={ASSISTANT_BUBBLE}>
                {item.toolsUsed && item.toolsUsed.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {item.toolsUsed.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-muted-foreground"
                      >
                        <SearchIcon className="size-3" aria-hidden />
                        {toolDisplayName(t)}
                      </span>
                    ))}
                  </div>
                )}
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {item.content}
                </ReactMarkdown>
              </div>
            </div>
          ),
        )}

        {streaming !== null && (
          <div className="flex max-w-full items-start gap-2 self-start">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <SparklesIcon className="size-3.5" aria-hidden />
            </span>
            <div className={ASSISTANT_BUBBLE}>
              {activeTools.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {activeTools.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-muted-foreground"
                    >
                      <SearchIcon className="size-3" aria-hidden />
                      {toolDisplayName(t)}
                    </span>
                  ))}
                </div>
              )}
              {streaming ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {streaming}
                </ReactMarkdown>
              ) : (
                // No text yet — whether we're waiting on a tool or the first
                // token, keep the usual "Thinking..." so the turn never looks
                // stalled while a tool runs.
                <span className="text-muted-foreground">Thinking...</span>
              )}
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <span>{error.message}</span>
            {error.retryable && (
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

      {history.length === 0 && streaming === null && !error && (
        <div className="mx-auto flex w-full max-w-[608px] flex-wrap gap-2 px-3 pb-1 pt-2">
          {CHAT_SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => void sendContent(s)}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="border-t border-border px-3 py-3">
        <div className="relative mx-auto w-full max-w-[608px] rounded-full bg-gradient-to-r from-red-500 to-blue-500 p-px">
          <div className="flex h-12 w-full items-center gap-1 rounded-full bg-card pl-1.5 pr-1.5">
            {onSelectConversation && (
              <ChatHistoryPopover onSelect={onSelectConversation} />
            )}
            <Input
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void onSend()
                }
              }}
              placeholder="How can I help?"
              disabled={busy}
              aria-label="Ask a question"
              className="h-9 flex-1 border-0 bg-transparent px-2 text-[15px] shadow-none focus-visible:border-0 focus-visible:ring-0"
            />
            <IconButton
              type="button"
              size="small"
              variant="ghost"
              aria-label={
                dictation.status === 'recording'
                  ? 'Stop dictation'
                  : 'Dictate a message'
              }
              className="size-10 shrink-0"
              disabled={busy || dictation.status === 'stopping'}
              onClick={() => void dictation.toggle()}
            >
              {dictation.busy ? (
                <Loader2Icon className="size-5 animate-spin" aria-hidden />
              ) : dictation.status === 'recording' ? (
                <SquareIcon
                  className="size-5 animate-pulse text-red-500"
                  aria-hidden
                />
              ) : (
                <MicIcon className="size-5" aria-hidden />
              )}
            </IconButton>
            <IconButton
              type="button"
              size="small"
              aria-label="Send"
              className="size-10 shrink-0 bg-primary text-primary-foreground"
              onClick={() => void onSend()}
              disabled={composer.trim().length === 0 || busy}
              loading={busy}
            >
              <SparklesIcon className="size-5" aria-hidden />
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  )
}
