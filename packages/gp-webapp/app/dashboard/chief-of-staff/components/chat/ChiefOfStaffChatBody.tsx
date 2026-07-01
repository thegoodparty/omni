'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Badge,
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
import { chiefOfStaffChatApi } from '../../data/chat-api'
import type { ManagerChatClient } from '../../../shared/manager-chat/chatClient'
import type {
  ChatErrorCode,
  ChatMessageDto,
  ChatMessageSegment,
  ChatStreamEvent,
} from '../../data/contracts'
import {
  COS_INTRO_MESSAGES,
  toolDisplayName,
  toolStatusLabel,
} from './chatConstants'
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
  /** When the parent surface closes, set false to abort the in-flight stream. */
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
  chatApi?: ManagerChatClient
  analyticsLabel?: string
  historyKey?: readonly unknown[]
  /** Default intro played on the first chat when no `opener` is given. */
  defaultIntro?: string[]
}

type ChatItem =
  | { kind: 'user'; id: string; content: string }
  | {
      kind: 'assistant'
      id: string
      content: string
      toolsUsed?: string[]
      // Persisted ordered structure (reloaded turns that used tools). When set,
      // the assistant message renders these blocks instead of flat content.
      segments?: ChatMessageSegment[]
    }

// Fold the flat persisted segments into render blocks: a text run, or a group
// of consecutive tool pills (matches the live in-progress layout). Tools are
// stored as display labels and deduped within a group, so a run of calls that
// share a label (e.g. several constituent-data queries) shows one pill, not a
// stack — same as the live builder.
type RenderBlock =
  | { kind: 'text'; text: string }
  | { kind: 'tools'; labels: string[] }

function groupSegments(segments: ChatMessageSegment[]): RenderBlock[] {
  const blocks: RenderBlock[] = []
  for (const seg of segments) {
    if (seg.kind === 'text') {
      blocks.push({ kind: 'text', text: seg.text ?? '' })
      continue
    }
    const label = toolDisplayName(seg.toolName ?? '')
    const last = blocks[blocks.length - 1]
    if (last && last.kind === 'tools') {
      if (!last.labels.includes(label)) last.labels.push(label)
    } else {
      blocks.push({ kind: 'tools', labels: [label] })
    }
  }
  return blocks
}

// The in-progress assistant turn, rendered as ordered blocks (text, tool-group,
// text, ...) in the order events arrive — so a tool's wait reads as its own
// "Thinking..." block instead of being buried under the text. Live-only; the
// committed message still stores flat content + toolsUsed.
type LiveSegment =
  | { kind: 'text'; text: string }
  | { kind: 'tools'; tools: string[]; running: boolean }

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

// A tool_call event carries the tool's input as `args` (unknown). Pull the
// `action` field when present so the status label can reflect what the tool is
// doing (e.g. reading vs saving priorities).
function toolAction(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null || !('action' in args)) {
    return undefined
  }
  const action = args.action
  return typeof action === 'string' ? action : undefined
}

function messageToItem(msg: ChatMessageDto): ChatItem | null {
  if (msg.role === 'user') {
    return { kind: 'user', id: msg.id, content: msg.content }
  }
  if (msg.role === 'assistant') {
    return {
      kind: 'assistant',
      id: msg.id,
      content: msg.content,
      ...(msg.segments && msg.segments.length > 0
        ? { segments: msg.segments }
        : {}),
    }
  }
  return null
}

const INTRO_SEEN_KEY = 'cos-intro-streamed'

// Starter prompts shown on a fresh chat; tapping one sends it.
const CHAT_SUGGESTIONS = [
  "What's most urgent this week?",
  'How many of my constituents are homeowners?',
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
  opener,
  active = true,
  onConversationCreated,
  onSelectConversation,
  bodyClassName,
  chatApi = chiefOfStaffChatApi,
  analyticsLabel = 'chief-of-staff-chat',
  historyKey = HISTORY_KEY,
  defaultIntro = COS_INTRO_MESSAGES,
}: Props): React.JSX.Element {
  const queryClient = useQueryClient()
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [history, setHistory] = useState<ChatItem[]>([])
  const [streaming, setStreaming] = useState<string | null>(null)
  // Ordered blocks for the in-progress turn (see LiveSegment). Replaces the old
  // flat "all pills on top + one text blob" view.
  const [segments, setSegments] = useState<LiveSegment[]>([])
  const [composer, setComposer] = useState('')
  const dictation = useDictationAppend({
    value: composer,
    onChange: setComposer,
    analyticsLabel,
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
    chatApi,
    historyKey,
  )
  const isFirstChat =
    !conversationIdOverride &&
    priorConversations !== undefined &&
    priorConversations.length === 0

  // An onboarding-card opener always plays; otherwise the default intro plays
  // only on the user's first chat. Either way it's the same typed animation.
  const introMessages = opener ?? defaultIntro
  const introTotal = useMemo(
    () => introMessages.reduce((sum, m) => sum + m.length, 0),
    [introMessages],
  )

  // Type the intro in with a single counter + interval. A counter is
  // StrictMode-safe (the discarded first mount only advances it; no duplicate
  // bubbles or interleaved chains like a recursive setTimeout closure).
  useEffect(() => {
    const isOpener = opener !== undefined
    // Default intro is gated to the first chat, once ever (localStorage). An
    // opener bypasses both gates so it replays on every card click.
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
      // Mark seen once typing actually begins — set here, not at effect entry,
      // so StrictMode's discarded first mount (whose interval is cleared
      // before it ticks) doesn't suppress the real run.
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

  // Per-message visible slices derived from the single progress counter.
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
      setSegments([])
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
        // Ordered blocks for the live render, built from the same events.
        let segs: LiveSegment[] = []
        const commitSegs = (next: LiveSegment[]): void => {
          segs = next
          setSegments(next)
        }
        // Raw ordered segments mirroring what the backend persists (raw tool
        // names, not display labels). Committed to history so a just-finished
        // turn renders the same interleaving as a reloaded one.
        const committedSegs: ChatMessageSegment[] = []
        const pushCommittedText = (delta: string): void => {
          if (!delta) return
          const last = committedSegs[committedSegs.length - 1]
          if (last && last.kind === 'text') {
            last.text = (last.text ?? '') + delta
          } else {
            committedSegs.push({ kind: 'text', text: delta })
          }
        }
        // A tool group stops "running" as soon as any text follows it.
        const resolveRunningTools = (list: LiveSegment[]): LiveSegment[] =>
          list.map((s) =>
            s.kind === 'tools' && s.running ? { ...s, running: false } : s,
          )

        for await (const ev of iter) {
          if (ev.type === 'text') {
            // The post-tool paragraph break is applied ONLY to the flat
            // `assembled` content (the no-tool fallback that renders as one
            // bubble). Segments — both the live `segs` and the committed ones —
            // store RAW deltas, matching what the backend persists, so a
            // freshly-streamed turn and a reloaded one render identically.
            // Separate text segments are already separate bubbles, so the gap
            // doesn't need the literal break.
            const needsBreak =
              breakBeforeNextText &&
              assembled.length > 0 &&
              !/\s$/.test(assembled) &&
              !/^\s/.test(ev.delta)
            breakBeforeNextText = false
            assembled += needsBreak ? `\n\n${ev.delta}` : ev.delta
            pushCommittedText(ev.delta)
            setStreaming(assembled)
            // Segment view: close any running tool group, then extend or open
            // the trailing text block.
            const resolved = resolveRunningTools(segs)
            const last = resolved[resolved.length - 1]
            commitSegs(
              last && last.kind === 'text'
                ? [
                    ...resolved.slice(0, -1),
                    { kind: 'text', text: last.text + ev.delta },
                  ]
                : [...resolved, { kind: 'text', text: ev.delta }],
            )
          } else if (ev.type === 'tool_call') {
            if (assembled.length > 0) breakBeforeNextText = true
            if (!turnTools.includes(ev.toolName)) {
              turnTools.push(ev.toolName)
            }
            committedSegs.push({ kind: 'tool', toolName: ev.toolName })
            // Segment view: store the resolved (action-aware) label and group
            // consecutive tool calls into one running block. turnTools keeps the
            // raw names for the committed message (reload has no args).
            const label = toolStatusLabel(ev.toolName, toolAction(ev.args))
            const last = segs[segs.length - 1]
            if (last && last.kind === 'tools' && last.running) {
              if (!last.tools.includes(label)) {
                commitSegs([
                  ...segs.slice(0, -1),
                  { ...last, tools: [...last.tools, label] },
                ])
              }
            } else {
              commitSegs([
                ...segs,
                { kind: 'tools', tools: [label], running: true },
              ])
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
              ...(committedSegs.some((s) => s.kind === 'tool')
                ? { segments: committedSegs }
                : turnTools.length > 0 && { toolsUsed: [...turnTools] }),
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
        setSegments([])
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
  const showIntro =
    (opener !== undefined || isFirstChat) &&
    history.length === 0 &&
    !streaming &&
    !error

  return (
    // vaul disables text selection on the drawer (user-select:none on fine
    // pointers) and treats pointer-drags as drawer-drags. select-text restores
    // selection and data-vaul-no-drag stops a select-drag from moving the
    // sheet, so users can highlight and copy chat text.
    <div className="flex min-h-0 flex-1 flex-col select-text" data-vaul-no-drag>
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
              {item.segments && item.segments.length > 0 ? (
                // Reloaded turn that used tools: replay the persisted ordered
                // text/tool blocks, matching the in-progress layout.
                <div className="flex min-w-0 max-w-full flex-col gap-2">
                  {groupSegments(item.segments).map((block, i) =>
                    block.kind === 'text' ? (
                      <div key={`b-${i}`} className={ASSISTANT_BUBBLE}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {block.text}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <div key={`b-${i}`} className="flex flex-wrap gap-1.5">
                        {block.labels.map((label) => (
                          <span
                            key={label}
                            className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-muted-foreground"
                          >
                            <SearchIcon className="size-3" aria-hidden />
                            {label}
                          </span>
                        ))}
                      </div>
                    ),
                  )}
                </div>
              ) : (
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
              )}
            </div>
          ),
        )}

        {streaming !== null && (
          <div className="flex max-w-full items-start gap-2 self-start">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <SparklesIcon className="size-3.5" aria-hidden />
            </span>
            <div className="flex min-w-0 max-w-full flex-col gap-2">
              {segments.length === 0 && (
                <div className={ASSISTANT_BUBBLE}>
                  <span className="text-shimmer-muted">Thinking...</span>
                </div>
              )}
              {segments.map((seg, i) =>
                seg.kind === 'text' ? (
                  <div key={`seg-${i}`} className={ASSISTANT_BUBBLE}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {seg.text}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div key={`seg-${i}`} className="flex flex-wrap gap-1.5">
                    {seg.tools.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-muted-foreground"
                      >
                        <SearchIcon className="size-3" aria-hidden />
                        {seg.running ? (
                          <span className="text-shimmer">{t}</span>
                        ) : (
                          t
                        )}
                      </span>
                    ))}
                  </div>
                ),
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
        <div className="mx-auto flex w-full max-w-3xl flex-wrap gap-2 px-3 pb-1 pt-2">
          {CHAT_SUGGESTIONS.map((s) => (
            <Badge
              key={s}
              asChild
              variant="soft"
              shape="pill"
              className="h-auto border-border bg-grayscale-50 px-3 py-1.5 disabled:pointer-events-none disabled:opacity-50"
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => void sendContent(s)}
              >
                {s}
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="border-t border-border px-3 py-3">
        <div className="relative mx-auto w-full max-w-[608px] rounded-full bg-gradient-to-r from-red-500 to-blue-500 p-px">
          <div className="flex h-12 w-full items-center gap-1 rounded-full bg-card pl-1.5 pr-1.5">
            {onSelectConversation && (
              <ChatHistoryPopover
                onSelect={onSelectConversation}
                chatApi={chatApi}
                historyKey={historyKey}
              />
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
