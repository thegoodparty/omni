'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ASSISTANT_BUBBLE, ChatMarkdown } from '../agent-chat/chatUI'
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
import type { AiChatClient, AiChatConfig, ChatMessageSegment } from './types'
import { CHAT_MAX_W } from './constants'
import AiChatHistoryPopover from './AiChatHistoryPopover'
import ChatPill from './ChatPill'
import { useAiChat } from './useAiChat'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  const [composer, setComposer] = useState('')
  const [multiline, setMultiline] = useState(false)
  const dictation = useDictationAppend({
    value: composer,
    onChange: setComposer,
    analyticsLabel: config.title.toLowerCase().replace(/\s+/g, '-') + '-chat',
  })
  const [introProgress, setIntroProgress] = useState(0)
  const [feedback, setFeedback] = useState<
    Record<string, 'up' | 'down' | undefined>
  >({})

  const {
    history,
    streaming,
    liveStatus,
    activeTools,
    error,
    creating,
    busy,
    sendContent,
    onRetry,
  } = useAiChat({
    chatApi,
    conversationIdOverride,
    active,
    onConversationCreated,
    surface: config.title,
  })

  // TODO: feedback is local-only and lost on close. Persist via the chat API
  // (e.g. chatApi.submitFeedback(messageId, value)) once the endpoint exists.
  const onFeedback = useCallback((id: string, value: 'up' | 'down' | '') => {
    setFeedback((prev) => ({ ...prev, [id]: value || undefined }))
  }, [])

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
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

  // Reset the once-per-open dictation guard when the surface closes; the body
  // isn't unmounted on close (same key for new-conversation slots).
  useEffect(() => {
    if (!active) autoDictateStartedRef.current = false
  }, [active])

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

  const onSend = useCallback(async () => {
    const trimmed = composer.trim()
    if (!trimmed || busy) return
    // Stop dictation on send so the mic doesn't keep transcribing into the
    // now-cleared composer after the message goes out.
    if (dictation.status === 'recording') void dictation.stop()
    setComposer('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    setMultiline(false)
    await sendContent(trimmed)
  }, [composer, sendContent, dictation, busy])

  const toolLabel = (toolName: string): string =>
    config.toolDisplayNames?.[toolName] ?? toolName

  const renderMessage = (content: string) =>
    messageRenderer ? (
      messageRenderer(content)
    ) : (
      <ChatMarkdown>{content}</ChatMarkdown>
    )

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
              // isComposing: don't send on the Enter that commits an IME
              // candidate (CJK and other composed input) — it would fire a
              // half-composed message and swallow the confirmation.
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
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
