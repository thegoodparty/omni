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
import { SparklesIcon } from '@styleguide/components/ui/icons'
import {
  ASSISTANT_BUBBLE,
  AssistantMarkdown,
  ToolPillRow,
} from '../../../shared/agent-chat/chatUI'
import { useDictationAppend } from '../../../briefings/shared/useDictationAppend'
import { reportErrorToSentry } from '@shared/sentry'
import { chiefOfStaffChatApi } from '../../data/chat-api'
import type { AgentChatClient } from '../../../shared/agent-chat/chatClient'
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
  composerRef?: RefObject<HTMLInputElement | null>
  /**
   * Message contents to drop from a reloaded transcript before it renders.
   * Hides persisted sentinel turns (e.g. the story-kickoff sentinel) that
   * exist only to keep the server-side history alternating. Default empty: no
   * filtering, so Chief of Staff / Community Issues / Ordinance are unchanged.
   */
  hiddenMessageContents?: string[]
}

/**
 * A starter chip. `kickoff` fires an on-demand hidden send of that string
 * (through the body's own `send`, no user bubble); otherwise `onSelect` runs.
 * `description` renders a secondary line beneath the label.
 */
export type ChatSuggestion = {
  label: string
  description?: string
  onSelect?: () => void
  kickoff?: string
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
  suggestions,
  showSuggestionsWithGreeting = false,
  quickPrompts,
  composerPlaceholder = 'How can I help?',
  pendingKickoff,
  composerRef,
  hiddenMessageContents = NO_HIDDEN_CONTENTS,
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
  // True once anything has been sent this session (visible OR hidden). Gates the
  // with-greeting starter chips off after a hidden kickoff (which adds no user
  // turn). State, so it re-renders; resets naturally on remount / new chat.
  const [hasSent, setHasSent] = useState(false)
  const [creating, setCreating] = useState(false)
  const [sending, setSending] = useState(false)
  const [introProgress, setIntroProgress] = useState(0)
  // Characters of the live turn's text revealed so far — the streamed reply is
  // typed toward what has actually arrived instead of jumping per SSE chunk.
  const [revealed, setRevealed] = useState(0)
  // A reloaded transcript with no user turn yet (the server-seeded greeting)
  // is typed in on open instead of dumped, then committed to history.
  const [playback, setPlayback] = useState<{
    items: ChatItem[]
    progress: number
  } | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  // Tracks the pendingKickoff value that has already fired, not just a boolean:
  // the parent clears pendingKickoff on close and re-sets the same sentinel on
  // reopen, and the body stays mounted, so a value-based guard (reset when the
  // kickoff clears) lets that second open fire again instead of dropping it.
  const kickedOffRef = useRef<string | undefined>(undefined)
  const loadRequestedRef = useRef(false)
  const creatingRef = useRef(false)
  const sendingRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // Local handle on the composer input (merged with the optional caller ref) so
  // a completed turn can return focus to it — see the refocus effect below.
  const composerInputRef = useRef<HTMLInputElement | null>(null)
  const assignComposerRef = useCallback(
    (node: HTMLInputElement | null) => {
      composerInputRef.current = node
      if (composerRef) composerRef.current = node
    },
    [composerRef],
  )
  const revealedRef = useRef(0)
  const liveTextTotalRef = useRef(0)
  // Set while a finished reply's reveal is still draining; invoking it commits
  // the reply to history immediately (a mid-drain send flushes it first so the
  // transcript stays ordered).
  const pendingCommitRef = useRef<(() => void) | null>(null)
  const playbackRef = useRef<{ items: ChatItem[]; progress: number } | null>(
    null,
  )

  useEffect(() => {
    playbackRef.current = playback
  }, [playback])

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

  // Smooth reveal for the live stream: tick the revealed counter toward the
  // text that has arrived. The step scales with the backlog, so the reveal
  // trails the network by a bounded amount and drains quickly after `done`.
  const streamingActive = streaming !== null
  useEffect(() => {
    if (!streamingActive) return
    const id = setInterval(() => {
      setRevealed((r) => {
        const total = liveTextTotalRef.current
        if (r >= total) return r
        const next = Math.min(
          total,
          r + Math.max(2, Math.ceil((total - r) / 50)),
        )
        revealedRef.current = next
        return next
      })
    }, 24)
    return () => clearInterval(id)
  }, [streamingActive])

  // The live segments sliced to the revealed budget. A partially revealed text
  // block hides everything after it, so a tool pill never appears ahead of the
  // text that precedes it.
  const visibleSegments = useMemo(() => {
    let budget = revealed
    const out: LiveSegment[] = []
    for (const seg of segments) {
      if (seg.kind !== 'text') {
        out.push(seg)
        continue
      }
      if (budget < seg.text.length) {
        if (budget > 0) {
          out.push({ kind: 'text', text: seg.text.slice(0, budget) })
        }
        return out
      }
      out.push(seg)
      budget -= seg.text.length
    }
    return out
  }, [segments, revealed])

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
    setHistory((prev) => (prev.length === 0 ? playback.items : prev))
    setPlayback(null)
  }, [playback])

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
    setCreating(true)
    try {
      setConversationId(conversationIdOverride)
      const msgs = await chatApi.listMessages(conversationIdOverride)
      // Drop persisted sentinel turns (e.g. the story-kickoff sentinel) so
      // they never enter history/playback or render as a raw bubble. A hidden
      // sentinel is a USER turn whose canned assistant reply immediately
      // follows it, so also skip that reply. Otherwise it reloads as an
      // orphaned assistant bubble with no preceding user message. (The one-off
      // story/product greeting therefore does not render on reload, an
      // accepted cosmetic.)
      const hidden = new Set(hiddenMessageContents)
      const items: ChatItem[] = []
      let skipNextAssistant = false
      for (const m of msgs) {
        if (hidden.has(m.content)) {
          skipNextAssistant = m.role === 'user'
          continue
        }
        if (skipNextAssistant && m.role === 'assistant') {
          skipNextAssistant = false
          continue
        }
        skipNextAssistant = false
        const it = messageToItem(m)
        if (it) items.push(it)
      }
      // No user turn yet means this is the server-seeded greeting (Campaign
      // Manager seeds it on create). Play it like a live reply instead of
      // dumping it as an already-sent transcript. Segment-bearing turns render
      // structured blocks the playback can't, so they always dump.
      const playable =
        items.length > 0 &&
        items.every(
          (it) => it.kind === 'assistant' && !(it.segments ?? []).length,
        )
      if (playable) {
        setPlayback({ items, progress: 0 })
      } else {
        setHistory(items)
      }
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
  }, [conversationIdOverride, hiddenMessageContents])

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
  }, [streaming, history.length, revealed, playback])

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
      setRevealed(0)
      revealedRef.current = 0
      liveTextTotalRef.current = 0
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
          // Kept on a ref (not derived from state) so the post-`done` wait
          // below sees the total synchronously with the stream.
          liveTextTotalRef.current = next.reduce(
            (sum, s) => (s.kind === 'text' ? sum + s.text.length : sum),
            0,
          )
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
          // Network phase is over — release the send lock so the user can
          // compose while the reveal drains.
          sendingRef.current = false
          setSending(false)
          const assistantItem: ChatItem = {
            kind: 'assistant',
            id: assistantId ?? `local_assistant_${clientMessageId}`,
            content: assembled,
            ...(committedSegs.some((s) => s.kind === 'tool')
              ? { segments: committedSegs }
              : turnTools.length > 0 && { toolsUsed: [...turnTools] }),
          }
          let committed = false
          const commit = (): void => {
            if (committed) return
            committed = true
            pendingCommitRef.current = null
            setHistory((prev) => [...prev, assistantItem])
            setStreaming(null)
            setSegments([])
          }
          pendingCommitRef.current = commit
          // Let the smooth reveal finish before committing, so the tail of
          // the reply types out instead of snapping in with the history swap.
          while (
            !committed &&
            !controller.signal.aborted &&
            revealedRef.current < liveTextTotalRef.current
          ) {
            await new Promise((resolve) => setTimeout(resolve, 40))
          }
          // A close-abort mid-drain skips the local commit — the server has
          // already persisted the message, so it replays on reload.
          if (!controller.signal.aborted) commit()
          if (pendingCommitRef.current === commit) {
            pendingCommitRef.current = null
          }
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
        // Guard on our own controller: a mid-drain send may have started the
        // next turn, whose state this turn's cleanup must not clobber.
        if (abortRef.current === controller) {
          sendingRef.current = false
          setSending(false)
          setSegments([])
          abortRef.current = null
        }
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

  // The shared send path. `hidden` skips the optimistic user bubble so a
  // kickoff message streams a reply without showing the prompt that triggered
  // it (the server hides it / returns a canned reply); everything else (the
  // reveal-drain commit, the mid-playback flush, the stream) is identical.
  const send = useCallback(
    async (content: string, options?: { hidden?: boolean }) => {
      const trimmed = content.trim()
      if (!trimmed) return false
      if (sendingRef.current || creatingRef.current) return false
      sendingRef.current = true
      setHasSent(true)
      const clientMessageId = newClientMessageId()
      // A send during a reveal drain commits the previous assistant message
      // first so the transcript stays ordered.
      pendingCommitRef.current?.()
      // Sending mid-playback flushes the rest of the greeting instantly so
      // the transcript stays ordered ahead of the user's message.
      const pending = playbackRef.current
      if (pending) {
        setPlayback(null)
        // History is empty for the whole playback; the length guard keeps a
        // same-frame race with the completion effect from double-committing.
        setHistory((prev) =>
          prev.length === 0 ? [...pending.items, ...prev] : prev,
        )
      }
      if (!options?.hidden) {
        setHistory((prev) => [
          ...prev,
          { kind: 'user', id: `local_${clientMessageId}`, content: trimmed },
        ])
      }
      await executeUserTurn(trimmed, clientMessageId)
      return true
    },
    [executeUserTurn],
  )

  const sendContent = useCallback(
    (content: string) => send(content, { hidden: false }),
    [send],
  )

  // Starter chips: the caller's list, or the CoS defaults that send the chip's
  // own label as a message (byte-for-byte the prior hardwired behavior).
  const effectiveSuggestions = useMemo<ChatSuggestion[]>(
    () =>
      suggestions ??
      CHAT_SUGGESTIONS.map((label) => ({
        label,
        onSelect: () => void sendContent(label),
      })),
    [suggestions, sendContent],
  )

  // The with-greeting chips show only while the conversation is pristine:
  // nothing sent this session and the transcript is at most the single seeded
  // greeting (still playing back, or just committed). A hidden kickoff sets
  // hasSent with no user turn, and a resumed conversation with a prior reply
  // has more than one message, so both correctly hide the chips.
  const isPristineGreeting =
    !hasSent && history.length + (playback?.items.length ?? 0) <= 1

  // Fire the one-shot kickoff once the surface is open and any load/create has
  // settled, so it appends to the resolved conversation rather than racing a
  // fresh create. `creating`/`creatingRef` gate on an in-flight load or create.
  // With an override, also hold until that conversation's id has actually been
  // applied: `loadExisting` sets `conversationId` and `creating` in the same
  // synchronous pass this effect runs in, so reading `creating` alone is stale
  // on that first pass, but `conversationId` is still null then too, so the
  // override guard keeps the kickoff from firing (and minting a fresh
  // conversation) until the resumed id is settled. The ref guards a re-render
  // from re-firing it.
  useEffect(() => {
    // Reset on clear so a later re-set to the same sentinel (close then reopen)
    // counts as a fresh kickoff.
    if (!pendingKickoff) {
      kickedOffRef.current = undefined
      return
    }
    if (!active || kickedOffRef.current === pendingKickoff) return
    if (creating || creatingRef.current) return
    if (conversationIdOverride && conversationId !== conversationIdOverride) {
      return
    }
    kickedOffRef.current = pendingKickoff
    void send(pendingKickoff, { hidden: true })
  }, [
    active,
    pendingKickoff,
    creating,
    conversationId,
    conversationIdOverride,
    send,
  ])

  // A chip with `kickoff` fires an on-demand hidden send of that string;
  // otherwise it defers to the chip's own `onSelect`.
  const onSuggestionClick = useCallback(
    (s: ChatSuggestion) => {
      if (s.kickoff) {
        void send(s.kickoff, { hidden: true })
        return
      }
      s.onSelect?.()
    },
    [send],
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
  // The composer is disabled while a turn runs (busy), which blurs it. When the
  // turn finishes and the input re-enables, return focus so the candidate can
  // keep chatting without clicking back in. Gated on active !== false so a
  // background turn on a closed surface can't steal focus.
  const prevBusyRef = useRef(busy)
  useEffect(() => {
    const wasBusy = prevBusyRef.current
    prevBusyRef.current = busy
    if (wasBusy && !busy && active !== false) {
      composerInputRef.current?.focus()
    }
  }, [busy, active])
  const showIntro =
    (opener !== undefined || isFirstChat) &&
    history.length === 0 &&
    !streaming &&
    !playback &&
    !error

  // The starter suggestions + quick prompts show on an empty transcript, or
  // alongside a seeded greeting when the caller opts in.
  const showStarters =
    ((history.length === 0 && !playback) ||
      (showSuggestionsWithGreeting && isPristineGreeting)) &&
    streaming === null &&
    !error
  // Suggestions carrying a description render as full-width cards (Campaign
  // Manager); description-less ones stay pills (Chief of Staff / Community
  // Issues).
  const suggestionsAsCards = effectiveSuggestions.some((s) =>
    Boolean(s.description),
  )

  return (
    // vaul disables text selection on the drawer (user-select:none on fine
    // pointers) and, on pointerdown, pointer-captures the target — which cancels
    // any native drag-selection that spans more than one element (so you can
    // highlight within one paragraph but not across the whole message).
    // select-text restores the CSS; stopping pointerdown propagation keeps the
    // capture from happening at all (data-vaul-no-drag only blocks the drag, not
    // the capture), so users can highlight and copy a whole message. Dragging
    // the body no longer dismisses the drawer — the overlay and close button do.
    <div
      className="flex min-h-0 flex-1 flex-col select-text"
      data-vaul-no-drag
      onPointerDown={(e) => e.stopPropagation()}
    >
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

        {playbackParts.map((text, i) => (
          <div
            key={`pb-${i}`}
            className="flex max-w-full items-start gap-2 self-start"
          >
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <SparklesIcon className="size-3.5" aria-hidden />
            </span>
            <div className={ASSISTANT_BUBBLE}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
            </div>
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
                      <AssistantMarkdown key={`b-${i}`}>
                        {block.text}
                      </AssistantMarkdown>
                    ) : (
                      <ToolPillRow key={`b-${i}`} labels={block.labels} />
                    ),
                  )}
                </div>
              ) : (
                <div className={ASSISTANT_BUBBLE}>
                  {item.toolsUsed && item.toolsUsed.length > 0 && (
                    <ToolPillRow labels={item.toolsUsed.map(toolDisplayName)} />
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
              {visibleSegments.length === 0 && (
                <div className={ASSISTANT_BUBBLE}>
                  <span className="text-shimmer-muted">Thinking...</span>
                </div>
              )}
              {visibleSegments.map((seg, i) =>
                seg.kind === 'text' ? (
                  <AssistantMarkdown key={`seg-${i}`}>
                    {seg.text}
                  </AssistantMarkdown>
                ) : (
                  <ToolPillRow
                    key={`seg-${i}`}
                    labels={seg.tools}
                    running={seg.running}
                  />
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
              ref={assignComposerRef}
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void onSend()
                }
              }}
              placeholder={composerPlaceholder}
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
