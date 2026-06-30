'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Button,
  IconButton,
  Loader2Icon,
  MicIcon,
  SquareIcon,
  ToggleGroup,
  ToggleGroupItem,
} from '@styleguide'
import {
  SearchIcon,
  SendIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from '@styleguide/components/ui/icons'
import { useDictationAppend } from 'app/dashboard/briefings/shared/useDictationAppend'
import { reportErrorToSentry } from '@shared/sentry'
import type {
  AiChatClient,
  AiChatConfig,
  ChatErrorCode,
  ChatMessageDto,
  ChatMessageSegment,
  ChatStreamEvent,
} from './types'
import { CHAT_MAX_W } from './constants'
import AiChatHistoryPopover from './AiChatHistoryPopover'
import ChatPill from './ChatPill'
import { HISTORY_QUERY_KEY } from './useAiChatHistory'

// ---------------------------------------------------------------------------
// Markdown bubble — same override set as Chief of Staff and briefing chat
// ---------------------------------------------------------------------------
const ASSISTANT_BUBBLE =
  'w-full text-sm leading-relaxed text-foreground ' +
  'space-y-5 [&>:first-child]:mt-0 [&>:last-child]:mb-0 ' +
  '[&_p]:!block [&_p]:!flex-none [&_p]:!whitespace-normal ' +
  '[&_strong]:!inline [&_strong]:font-semibold [&_em]:!inline [&_em]:italic ' +
  '[&_a]:!inline [&_a]:underline [&_code]:!inline [&_code]:rounded ' +
  '[&_code]:bg-foreground/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs ' +
  '[&_pre]:!block [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-foreground/10 [&_pre]:p-3 [&_pre]:my-1 ' +
  '[&_pre_code]:!block [&_pre_code]:!bg-transparent [&_pre_code]:!px-0 [&_pre_code]:!py-0 [&_pre_code]:!rounded-none ' +
  '[&_li]:!list-item [&_li]:my-0 [&_ul]:!block [&_ul]:list-disc [&_ul]:pl-5 ' +
  '[&_ul]:space-y-2 [&_ol]:!block [&_ol]:list-decimal [&_ol]:pl-5 ' +
  '[&_ol]:space-y-2 [&_h1]:!block [&_h1]:text-base [&_h1]:font-semibold ' +
  '[&_h2]:!block [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:!block ' +
  '[&_h3]:text-sm [&_h3]:font-semibold [&_table]:!table [&_table]:!w-full ' +
  '[&_table]:!border-collapse [&_table]:my-2 [&_thead]:!table-header-group ' +
  '[&_tbody]:!table-row-group [&_tr]:!table-row [&_tr]:!border-b ' +
  '[&_tr]:border-foreground/15 [&_th]:!table-cell [&_th]:px-2 [&_th]:py-1.5 ' +
  '[&_th]:text-left [&_th]:font-semibold [&_th]:!border-b-2 ' +
  '[&_th]:!border-foreground/30 [&_td]:!table-cell [&_td]:px-2 [&_td]:py-1.5 ' +
  '[&_td]:align-top'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FRIENDLY_ERROR: Record<ChatErrorCode, string> = {
  rate_limited: 'Too many requests. Try again in a moment.',
  upstream_unavailable: 'Chat is temporarily unavailable. Try again.',
  aborted: '',
  conversation_not_found:
    'This chat is no longer available. Try starting a new one.',
  internal: 'Something went wrong. Try again.',
}

function friendlyError(code: ChatErrorCode): string {
  return FRIENDLY_ERROR[code] ?? 'Something went wrong. Try again.'
}

// CommonMark turns any line indented 4+ spaces into a code block, so model
// output that leaks leading indentation renders prose as a grey code box.
// Strip that indentation outside fenced (```) blocks before rendering.
// Trade-off: deeply nested list items (indented 4+ spaces) also flatten to a
// single level — acceptable for chat prose, where stray code boxes are worse.
function normalizeMarkdown(md: string): string {
  let inFence = false
  return md
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence
        return line
      }
      return inFence ? line : line.replace(/^ {4,}/, '')
    })
    .join('\n')
}

function newClientMessageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `cmid_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

function messageToItem(msg: ChatMessageDto): ChatItem | null {
  if (msg.role === 'user')
    return { kind: 'user', id: msg.id, content: msg.content }
  if (msg.role === 'assistant')
    return {
      kind: 'assistant',
      id: msg.id,
      content: msg.content,
      ...(msg.segments && msg.segments.length > 0
        ? { segments: msg.segments }
        : {}),
    }
  return null
}

// Fold persisted segments into ordered render blocks: a text run, or a group of
// consecutive tool pills (deduped by label within the group). Mirrors the Chief
// of Staff renderer so a turn shows ordered text / tools / text instead of a
// flat string plus one tool row.
type RenderBlock =
  | { kind: 'text'; text: string }
  | { kind: 'tools'; tools: string[] }

function groupSegments(segments: ChatMessageSegment[]): RenderBlock[] {
  const blocks: RenderBlock[] = []
  for (const seg of segments) {
    if (seg.kind === 'text') {
      blocks.push({ kind: 'text', text: seg.text ?? '' })
      continue
    }
    const tool = seg.toolName ?? ''
    const last = blocks[blocks.length - 1]
    if (last && last.kind === 'tools') {
      if (!last.tools.includes(tool)) last.tools.push(tool)
    } else {
      blocks.push({ kind: 'tools', tools: [tool] })
    }
  }
  return blocks
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatItem =
  | { kind: 'user'; id: string; content: string }
  | {
      kind: 'assistant'
      id: string
      content: string
      toolsUsed?: string[]
      segments?: ChatMessageSegment[]
    }

type ErrorState = {
  message: string
  retryable: boolean
  lastUserContent: string
  lastClientMessageId: string
  kind: 'init' | 'stream'
}

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
  /** Custom renderer for assistant message content. Defaults to ReactMarkdown. */
  messageRenderer?: (content: string) => React.ReactNode
  /** Optional content rendered between the messages area and the composer. */
  bottomSlot?: React.ReactNode
  /** Start dictation automatically on open (e.g. when entered via the mic). */
  autoDictate?: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [history, setHistory] = useState<ChatItem[]>([])
  const [streaming, setStreaming] = useState<string | null>(null)
  // Polite SR announcement of generation status — set on transitions only, so
  // the whole streamed answer isn't re-read on every token.
  const [liveStatus, setLiveStatus] = useState('')
  const [activeTools, setActiveTools] = useState<string[]>([])
  const [composer, setComposer] = useState('')
  const [multiline, setMultiline] = useState(false)
  const dictation = useDictationAppend({
    value: composer,
    onChange: setComposer,
    analyticsLabel: config.title.toLowerCase().replace(/\s+/g, '-') + '-chat',
  })
  const [error, setError] = useState<ErrorState | null>(null)
  const [creating, setCreating] = useState(false)
  const [sending, setSending] = useState(false)
  const [introProgress, setIntroProgress] = useState(0)
  const [feedback, setFeedback] = useState<
    Record<string, 'up' | 'down' | undefined>
  >({})

  // TODO: feedback is local-only and lost on close. Persist via the chat API
  // (e.g. chatApi.submitFeedback(messageId, value)) once the endpoint exists.
  const onFeedback = useCallback((id: string, value: 'up' | 'down' | '') => {
    setFeedback((prev) => ({ ...prev, [id]: value || undefined }))
  }, [])

  const abortRef = useRef<AbortController | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const loadRequestedRef = useRef(false)
  const creatingRef = useRef(false)
  const sendingRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // One-row textarea height (line-height + vertical padding), measured once.
  const oneRowHeightRef = useRef<number | null>(null)
  // Guard so auto-dictation starts at most once per mount.
  const autoDictateStartedRef = useRef(false)

  const introMessages = config.introMessages ?? []
  const introTotal = useMemo(
    () => introMessages.reduce((sum, m) => sum + m.length, 0),
    [introMessages],
  )

  const showIntroAnimation =
    introMessages.length > 0 &&
    !conversationIdOverride &&
    history.length === 0 &&
    !streaming &&
    !error

  // Type the intro in character by character on first-ever open.
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
          // Mark seen only once the animation finishes — closing mid-stream
          // should not suppress the intro on the next open.
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

  // Load an existing conversation when the override changes.
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
        surface: config.title,
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
  }, [conversationIdOverride, chatApi, config.title])

  useEffect(() => {
    if (!active || !conversationIdOverride) return
    void loadExisting()
  }, [active, conversationIdOverride, loadExisting])

  // Abort in-flight stream when the surface closes.
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

  // Auto-scroll to the latest content.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [streaming, history.length])

  // When opened via the mic (autoDictate), begin recording once the surface is
  // active so the user can talk straight away.
  useEffect(() => {
    if (!autoDictate || !active || autoDictateStartedRef.current) return
    if (dictation.status !== 'idle') return
    autoDictateStartedRef.current = true
    void dictation.start()
  }, [autoDictate, active, dictation.status, dictation.start])

  const ensureConversationId = useCallback(async (): Promise<string | null> => {
    if (conversationId) return conversationId
    if (creatingRef.current) return null
    creatingRef.current = true
    setCreating(true)
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
      setCreating(false)
    }
  }, [
    conversationId,
    chatApi,
    onConversationCreated,
    queryClient,
    config.title,
  ])

  const runStream = useCallback(
    async (targetId: string, content: string, clientMessageId: string) => {
      const controller = new AbortController()
      abortRef.current = controller
      sendingRef.current = true
      setSending(true)
      setStreaming('')
      setActiveTools([])
      setError(null)
      setLiveStatus('Generating response')

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
              message: friendlyError(errored.code),
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
          setLiveStatus('Response ready')
        }
      } catch (err) {
        reportErrorToSentry(err, {
          surface: config.title,
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
    [chatApi, config.title],
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
      if (!trimmed || sendingRef.current || creatingRef.current) return false
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
    const trimmed = composer.trim()
    if (!trimmed || sendingRef.current || creatingRef.current) return
    setComposer('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    setMultiline(false)
    await sendContent(trimmed)
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

  const toolLabel = (toolName: string): string =>
    config.toolDisplayNames?.[toolName] ?? toolName

  const renderMessage = (content: string) =>
    messageRenderer ? (
      messageRenderer(content)
    ) : (
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {normalizeMarkdown(content)}
      </ReactMarkdown>
    )

  const busy = sending || creating
  const suggestions = config.suggestions ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Messages */}
      <div
        ref={scrollRef}
        className={
          className ??
          `mx-auto flex min-h-0 w-full ${CHAT_MAX_W} flex-1 flex-col gap-10 overflow-y-auto px-4 py-5`
        }
        data-testid="ai-chat-conversation"
      >
        {creating && history.length === 0 && !streaming && (
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

        {history.map((item) =>
          item.kind === 'user' ? (
            <div
              key={item.id}
              className="self-end rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground break-words max-w-full"
            >
              {item.content}
            </div>
          ) : (
            <div
              key={item.id}
              className="self-start max-w-full text-sm text-foreground space-y-2"
            >
              {item.segments && item.segments.length > 0 ? (
                // Ordered text / tool / text blocks from the persisted segments.
                groupSegments(item.segments).map((block, bi) =>
                  block.kind === 'tools' ? (
                    <div key={`b-${bi}`} className="flex flex-wrap gap-1.5">
                      {block.tools.map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-muted-foreground"
                        >
                          <SearchIcon className="size-3" aria-hidden />
                          {toolLabel(t)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div key={`b-${bi}`} className={ASSISTANT_BUBBLE}>
                      {renderMessage(block.text)}
                    </div>
                  ),
                )
              ) : (
                <>
                  {item.toolsUsed && item.toolsUsed.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {item.toolsUsed.map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-muted-foreground"
                        >
                          <SearchIcon className="size-3" aria-hidden />
                          {toolLabel(t)}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className={ASSISTANT_BUBBLE}>
                    {renderMessage(item.content)}
                  </div>
                </>
              )}
              <ToggleGroup
                type="single"
                size="sm"
                value={feedback[item.id] ?? ''}
                onValueChange={(v) =>
                  onFeedback(item.id, v as 'up' | 'down' | '')
                }
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
            </div>
          ),
        )}

        {/* Announce generation status once, instead of re-reading the whole
            streamed answer on every token. */}
        <span className="sr-only" aria-live="polite">
          {liveStatus}
        </span>

        {streaming !== null && (
          <div className="self-start max-w-full text-sm text-foreground space-y-2">
            {activeTools.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {activeTools.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-muted-foreground"
                  >
                    <SearchIcon className="size-3" aria-hidden />
                    {toolLabel(t)}
                  </span>
                ))}
              </div>
            )}
            {streaming ? (
              <div className={ASSISTANT_BUBBLE}>{renderMessage(streaming)}</div>
            ) : activeTools.length === 0 ? (
              <span className="text-muted-foreground">Thinking...</span>
            ) : null}
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

      {/* Suggestion chips — only on a fresh chat. Same px-3-on-outer /
          max-w-inner structure as the composer so the chips' left edge lines
          up with the input pill's left edge at every width. */}
      {suggestions.length > 0 &&
        history.length === 0 &&
        streaming === null &&
        !error && (
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
                  onClick={() => void sendContent(s)}
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
        <ChatPill
          rounded={multiline ? '3xl' : 'full'}
          className={`mx-auto w-full ${CHAT_MAX_W} transition-all`}
          innerClassName={`overflow-hidden transition-all focus-within:ring-2 focus-within:ring-primary-focus focus-within:ring-offset-0 ${multiline ? 'items-end' : 'items-center'}`}
        >
          {onSelectConversation && (
            <AiChatHistoryPopover
              chatApi={chatApi}
              configTitle={config.title}
              onSelect={onSelectConversation}
            />
          )}
          <textarea
            ref={textareaRef}
            value={composer}
            onChange={(e) => {
              const ta = e.target
              setComposer(ta.value)
              ta.style.height = 'auto'
              const sh = ta.scrollHeight
              // Measure the one-row threshold once from the textarea's own
              // metrics so wrapping detection avoids a magic pixel value and
              // doesn't read layout on every keystroke.
              if (oneRowHeightRef.current === null) {
                const styles = window.getComputedStyle(ta)
                const lineHeight = parseFloat(styles.lineHeight) || 20
                const paddingY =
                  parseFloat(styles.paddingTop) +
                  parseFloat(styles.paddingBottom)
                oneRowHeightRef.current = lineHeight + paddingY + 1
              }
              setMultiline(sh > oneRowHeightRef.current)
              ta.style.height = `${sh}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void onSend()
              }
            }}
            placeholder={config.placeholder ?? 'How can I help?'}
            disabled={creating}
            aria-label="Ask a question"
            rows={1}
            className={`flex-1 resize-none overflow-y-hidden bg-transparent px-2 py-1.5 text-sm leading-snug text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 max-h-36${composer === '' ? ' whitespace-nowrap' : ''}`}
          />
          <IconButton
            type="button"
            size="medium"
            variant="ghost"
            aria-label={
              dictation.status === 'recording'
                ? 'Stop dictation'
                : 'Dictate a message'
            }
            className="shrink-0"
            disabled={busy || dictation.status === 'stopping'}
            onClick={() => void dictation.toggle()}
          >
            {dictation.busy ? (
              <Loader2Icon className="size-5 animate-spin" aria-hidden />
            ) : dictation.status === 'recording' ? (
              <SquareIcon
                className="size-5 animate-pulse text-destructive"
                aria-hidden
              />
            ) : (
              <MicIcon className="size-5" aria-hidden />
            )}
          </IconButton>
          <IconButton
            type="button"
            size="medium"
            aria-label="Send"
            className="shrink-0 bg-primary text-primary-foreground"
            onClick={() => void onSend()}
            // Disabled while a reply streams so the button can't look active
            // while the send handler bails mid-stream. Pattern-wide default.
            disabled={busy || composer.trim().length === 0}
          >
            <SendIcon className="size-4" aria-hidden />
          </IconButton>
        </ChatPill>
      </div>
    </div>
  )
}
