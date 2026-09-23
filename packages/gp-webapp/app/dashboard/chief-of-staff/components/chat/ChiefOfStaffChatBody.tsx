'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Badge, Button, toast } from '@styleguide'
import {
  ASSISTANT_BUBBLE,
  AssistantMarkdown,
  AssistantRow,
  ChatComposer,
  InlineSegments,
  ThinkingRow,
  UserBubble,
} from '../../../shared/agent-chat/chatUI'
import MessageActionBar from '../../../shared/agent-chat/MessageActionBar'
import { segmentsToLive } from '../../../shared/agent-chat/streaming'
import { useStreamingTurn } from '../../../shared/agent-chat/useStreamingTurn'
import { usePinnedAutoScroll } from '../../../shared/agent-chat/usePinnedAutoScroll'
import { useDictationAppend } from '../../../shared/dictation/useDictationAppend'
import { reportErrorToSentry } from '@shared/sentry'
import { chiefOfStaffChatApi } from '../../data/chat-api'
import type {
  AgentChatClient,
  ChatMessageDto,
} from '../../../shared/agent-chat/chatClient'
import { COS_INTRO_MESSAGES, toolDisplayName } from './chatConstants'
import ChatHistoryPopover from './ChatHistoryPopover'
import { HISTORY_KEY, useChatHistory } from '../../data/use-chat-history'
import {
  ShowListMapSchema,
  type ShowListMap,
  type ComposeHandoffPayload,
} from '@goodparty_org/contracts'
import type { ChatMessageSegment } from '../../../shared/agent-chat/chatTypes'
import ChatListMap from './ChatListMap'
import ChatBoundaryDrawer from './ChatBoundaryDrawer'
import { useAttachmentsEnabled } from '../../../shared/agent-chat/hooks/useAttachmentsEnabled'
import {
  uploadChatAttachment,
  linkChatAttachment,
  deleteChatAttachment,
  listChatAttachments,
  downloadChatAttachment,
  isSupportedAttachmentFile,
  linkErrorMessage,
  type ChatAttachmentState,
} from '../../../shared/agent-chat/chatAttachments-api'

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
  /**
   * Render the per-message action bar (copy + thumbs up/down) under each
   * persisted assistant turn. Opt-in: Chief of Staff and Campaign Manager pass
   * it; the issue and ordinance docks don't.
   */
  showMessageActions?: boolean
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
const LIST_MAP_TOOL = 'show_list_map'

// Pulls the widget payload back out of a persisted turn. Returns null for
// every turn without one, which is nearly all of them.
const listMapFromSegments = (
  segments: ChatMessageSegment[],
): ShowListMap | null => {
  const segment = segments.find((s) => s.toolName === LIST_MAP_TOOL)
  if (!segment) return null
  const parsed = ShowListMapSchema.safeParse(segment.payload)
  return parsed.success ? parsed.data : null
}

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
  showMessageActions = false,
}: Props): React.JSX.Element {
  const router = useRouter()
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
  const [liveListMap, setLiveListMap] = useState<ShowListMap | null>(null)
  // Which list the holder is drawing on, if any. Owned HERE rather than by
  // the map card that opens it: a streaming turn's row is rebuilt under a
  // new key the moment it commits, so an overlay mounted inside the card
  // would unmount mid-draw and take the ring with it. The card asks; the
  // body holds.
  // While one is open, every OTHER card's button goes away. A transcript
  // can hold several maps, and switching lists remounts the overlay, which
  // seeds its ring at mount and never again — so the second click would
  // silently discard whatever the holder had drawn for the first. The
  // overlay covers the viewport, so this is not reachable by mouse; it is
  // reachable by keyboard, because the overlay traps no focus.
  const [refiningList, setRefiningList] = useState<ShowListMap | null>(null)
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
  const lastAttachmentIdsRef = useRef<string[]>([])
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

  const attachmentsEnabled = useAttachmentsEnabled('chief_of_staff')

  const [attachments, setAttachments] = useState<ChatAttachmentState[]>([])

  const GUARD_KEY = 'serve-chat-attachments-guard'
  const [guardAcknowledged, setGuardAcknowledged] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(GUARD_KEY) === '1'
    } catch {
      return false
    }
  })

  const handleGuardAcknowledge = useCallback((): void => {
    try {
      window.localStorage.setItem(GUARD_KEY, '1')
    } catch {
      // private mode / storage disabled
    }
    setGuardAcknowledged(true)
  }, [])

  const toolLabel = useCallback(
    (name: string): string => toolDisplayName(name),
    [],
  )

  const { messages, setMessages, visibleSegments, sending, send } =
    useStreamingTurn(chatApi, {
      toolLabel,
      onTurnStart: () => {
        setStreamError(null)
        setLiveListMap(null)
      },
      // Cleared on settle as well as on start. The commit empties
      // liveSegments and swaps in the persisted transcript, whose segment
      // carries this same payload — so holding the live copy any longer
      // renders the card twice, once in the streaming row and once in
      // history, until the next message happens to clear it.
      onTurnSettle: () => setLiveListMap(null),
      onError: (message, retryable) => setStreamError({ message, retryable }),
      onEvent: (event) => {
        // The ARGS carry the payload, which is why this reads tool_call and
        // not tool_result: args are what the segment persists, so the same
        // payload replays on reload.
        if (event.type === 'tool_call' && event.toolName === LIST_MAP_TOOL) {
          const parsed = ShowListMapSchema.safeParse(event.args)
          if (parsed.success) setLiveListMap(parsed.data)
          // Consumed either way: a payload we cannot parse is still not a
          // pill the user should see.
          return true
        }
        return false
      },
    })

  const busy = sending || loading

  // Poll for attachment status updates while any are pending/processing.
  const hasPending = attachments.some(
    (a) => a.status === 'pending' || a.status === 'processing',
  )
  useEffect(() => {
    if (!attachmentsEnabled.enabled) return
    if (!conversationId) return
    if (!hasPending) return
    let cancelled = false
    const id = setInterval(() => {
      void listChatAttachments(conversationId)
        .then((updated) => {
          if (cancelled) return
          setAttachments((prev) => {
            if (prev.length === 0) return prev
            const temps = prev.filter((a) => a.id.startsWith('temp-'))
            if (temps.length === 0) return updated
            const updatedIds = new Set(updated.map((a) => a.id))
            return [...updated, ...temps.filter((t) => !updatedIds.has(t.id))]
          })
        })
        .catch((err) => {
          reportErrorToSentry(err, {
            surface: 'chief-of-staff-chat',
            phase: 'attachment-poll',
          })
        })
    }, 3000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [attachmentsEnabled.enabled, conversationId, hasPending])

  const handleRemoveAttachment = useCallback(
    async (id: string): Promise<void> => {
      // Optimistically remove from UI
      setAttachments((prev) => prev.filter((a) => a.id !== id))
      // Only call DELETE if the id is a real server id (not a temp-* optimistic entry)
      if (conversationId && !id.startsWith('temp-')) {
        try {
          await deleteChatAttachment(conversationId, id)
        } catch (err) {
          reportErrorToSentry(err, {
            surface: 'chief-of-staff-chat',
            phase: 'attachment-delete',
          })
        }
      }
    },
    [conversationId],
  )

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

  const handleAttachFile = useCallback(
    async (file: File): Promise<void> => {
      const cid = conversationId ?? (await ensureConversationId())
      if (!cid) return
      const tempId = `temp-${crypto.randomUUID()}`
      setAttachments((prev) => [
        ...prev,
        {
          id: tempId,
          fileName: file.name,
          status: 'pending',
          pageCount: null,
          failureReason: null,
        },
      ])
      try {
        const result = await uploadChatAttachment(cid, file)
        setAttachments((prev) =>
          prev.map((a) => (a.id === tempId ? result : a)),
        )
      } catch (err) {
        reportErrorToSentry(err, {
          surface: 'chief-of-staff-chat',
          phase: 'attachment-upload',
        })
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === tempId
              ? { ...a, status: 'failed', failureReason: 'Upload failed' }
              : a,
          ),
        )
      }
    },
    [conversationId, ensureConversationId],
  )

  const handleAttachLink = useCallback(
    async (url: string): Promise<void> => {
      const cid = conversationId ?? (await ensureConversationId())
      if (!cid) return
      const tempId = `temp-${crypto.randomUUID()}`
      setAttachments((prev) => [
        ...prev,
        {
          id: tempId,
          fileName: url,
          status: 'pending',
          pageCount: null,
          failureReason: null,
        },
      ])
      try {
        const result = await linkChatAttachment(cid, url)
        if (result.ok) {
          setAttachments((prev) => {
            const mapped = prev.map((a) =>
              a.id === tempId ? result.attachment : a,
            )
            const seen = new Set<string>()
            return mapped.filter((a) => {
              if (seen.has(a.id)) return false
              seen.add(a.id)
              return true
            })
          })
        } else {
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === tempId
                ? {
                    ...a,
                    status: 'failed',
                    failureReason: linkErrorMessage(result.error),
                  }
                : a,
            ),
          )
        }
      } catch (err) {
        reportErrorToSentry(err, {
          surface: 'chief-of-staff-chat',
          phase: 'attachment-link',
        })
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === tempId
              ? {
                  ...a,
                  status: 'failed',
                  failureReason: "Couldn't attach that link. Try again.",
                }
              : a,
          ),
        )
      }
    },
    [conversationId, ensureConversationId],
  )

  // Drag-and-drop anywhere on the chat surface attaches the dropped files
  // through the same upload path as the paperclip. dragenter/dragleave fire on
  // every child crossed, so a depth counter decides when the pointer actually
  // left the surface.
  const dragDepthRef = useRef(0)
  const [dragActive, setDragActive] = useState(false)

  const dragHasFiles = (e: React.DragEvent): boolean =>
    Array.from(e.dataTransfer.types).includes('Files')

  const handleDragEnter = useCallback(
    (e: React.DragEvent): void => {
      if (!attachmentsEnabled.enabled || !dragHasFiles(e)) return
      e.preventDefault()
      dragDepthRef.current += 1
      setDragActive(true)
    },
    [attachmentsEnabled.enabled],
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent): void => {
      if (!attachmentsEnabled.enabled || !dragHasFiles(e)) return
      // preventDefault is what makes the surface a valid drop target.
      e.preventDefault()
    },
    [attachmentsEnabled.enabled],
  )

  const handleDragLeave = useCallback((e: React.DragEvent): void => {
    if (!dragHasFiles(e)) return
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragActive(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent): void => {
      if (!attachmentsEnabled.enabled) return
      e.preventDefault()
      dragDepthRef.current = 0
      setDragActive(false)
      for (const file of Array.from(e.dataTransfer.files)) {
        if (isSupportedAttachmentFile(file)) {
          void handleAttachFile(file)
        } else {
          toast.error(
            `Can't attach ${file.name}. Use a PDF, DOCX, TXT, JPEG, or PNG.`,
          )
        }
      }
    },
    [attachmentsEnabled.enabled, handleAttachFile],
  )

  const handleCitationClick = useCallback(
    async (
      attachmentId: string,
      page: number | null | undefined,
    ): Promise<void> => {
      if (!conversationId) return
      // Open the tab immediately while the user gesture is still live so browsers
      // don't block the popup. Navigate it to the presigned URL once fetched.
      const tab = window.open('', '_blank')
      const result = await downloadChatAttachment(conversationId, attachmentId)
      if (!result) {
        tab?.close()
        toast.error('Source unavailable')
        return
      }
      const url = page != null ? `${result.url}#page=${page}` : result.url
      if (tab) {
        tab.location.href = url
      } else {
        toast.error('Allow pop-ups in your browser to open sources')
      }
    },
    [conversationId],
  )

  // Navigate-only for now: the draft-prefill plumbing (payload transport plus
  // the SocialFlow seam that reads it) ships together in ENG-11162, so compose
  // opens blank until that lands.
  const handleComposeHandoff = useCallback(
    (_payload: ComposeHandoffPayload): void => {
      router.push('/dashboard/outreach?compose=social')
    },
    [router],
  )

  // The shared send path. `hidden` skips the optimistic user bubble AND drops
  // the persisted user turn from the rendered transcript, so a kickoff streams a
  // reply without ever showing the prompt that triggered it.
  const deliver = useCallback(
    async (
      content: string,
      opts?: { hidden?: boolean; attachmentIds?: string[] },
    ): Promise<boolean> => {
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
      const readyAttachmentIds = !opts?.hidden
        ? (opts?.attachmentIds ??
          attachments.filter((a) => a.status === 'ready').map((a) => a.id))
        : []
      if (!opts?.hidden) lastAttachmentIdsRef.current = readyAttachmentIds
      await send(id, trimmed, {
        hidden: true,
        ...(readyAttachmentIds.length > 0 && {
          attachmentIds: readyAttachmentIds,
        }),
      })
      // Clear chips after send — the conversation's server-side attachment
      // list persists; the chip row resets so the user starts fresh.
      if (!opts?.hidden) setAttachments([])
      return true
    },
    [sending, playback, ensureConversationId, send, setMessages, attachments],
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
    const attachmentIds = lastAttachmentIdsRef.current
    if (content && conversationId) {
      void send(conversationId, content, {
        hidden: true,
        ...(attachmentIds.length > 0 && { attachmentIds }),
      })
      return
    }
    if (content) {
      void deliver(content, { hidden: false, attachmentIds })
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
    // The map is the one thing that can grow the transcript without any of
    // the above changing: onEvent consumes the show_list_map call, so a turn
    // that draws a map and says nothing pushes no segment and commits no
    // message until it settles. Without this the card renders below the fold
    // and the follow-scroll has nothing to react to.
    liveListMap,
  ])

  // `liveListMap` counts as something on screen. onEvent consumes the
  // show_list_map call, so a turn that draws a map and says nothing pushes no
  // segment at all — without this the thinking row would sit under a rendered
  // map until the commit poll landed.
  const working = sending && visibleSegments.length === 0 && !liveListMap

  const history = useMemo(
    () =>
      visibleMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        feedback: m.feedback ?? null,
        // Replayed from the persisted tool segment rather than remembered
        // from the live stream: a reloaded transcript never passes through
        // onEvent, and a map that only existed in the session that made it
        // would vanish under the user the moment they refreshed.
        listMap: listMapFromSegments(m.segments ?? []),
        // The map segment is dropped from the inline run, not just rendered
        // alongside it. Live, onEvent consumes the event so no pill is ever
        // built; on replay the segment is still in the transcript and would
        // project to a status pill reading `show_list_map` above the card it
        // already drew. The ordinance flow splits its present_* segments out
        // for the same reason.
        live:
          m.role === 'user'
            ? null
            : segmentsToLive(
                (m.segments ?? []).filter((s) => s.toolName !== LIST_MAP_TOOL),
                m.content,
              ),
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
      className="relative flex min-h-0 flex-1 flex-col select-text"
      data-vaul-no-drag
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
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
      {dragActive && (
        <div className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-background/80">
          <span className="text-sm font-medium text-foreground">
            Drop a file to attach it
          </span>
        </div>
      )}
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
            <AssistantRow key={m.id} fullWidth={Boolean(m.listMap)}>
              <InlineSegments
                segments={m.live}
                toolLabel={toolLabel}
                onCitationClick={
                  attachmentsEnabled.enabled && conversationId
                    ? handleCitationClick
                    : undefined
                }
                onComposeHandoff={handleComposeHandoff}
              />
              {m.listMap ? (
                <ChatListMap
                  {...m.listMap}
                  onRefineArea={refiningList ? undefined : setRefiningList}
                />
              ) : null}
              {showMessageActions && conversationId && m.content ? (
                <MessageActionBar
                  conversationId={conversationId}
                  messageId={m.id}
                  content={m.content}
                  chatApi={chatApi}
                  initialFeedback={m.feedback}
                />
              ) : null}
            </AssistantRow>
          ),
        )}

        {/* The map is its own reason to render this row. A turn can consist
            of nothing but the show_list_map call, and onEvent consumes that
            event rather than pushing a segment, so gating the row on
            segments alone hid the map until the transcript reloaded. */}
        {visibleSegments.length > 0 || liveListMap ? (
          <AssistantRow fullWidth={Boolean(liveListMap)}>
            <InlineSegments
              segments={visibleSegments}
              toolLabel={toolLabel}
              onCitationClick={
                attachmentsEnabled.enabled && conversationId
                  ? handleCitationClick
                  : undefined
              }
              onComposeHandoff={handleComposeHandoff}
            />
            {liveListMap ? (
              <ChatListMap
                {...liveListMap}
                onRefineArea={refiningList ? undefined : setRefiningList}
              />
            ) : null}
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
            {...(attachmentsEnabled.enabled
              ? {
                  attachments,
                  onAttachFile: (file) => void handleAttachFile(file),
                  onAttachLink: (url) => void handleAttachLink(url),
                  onRemoveAttachment: (id) => void handleRemoveAttachment(id),
                  guardAcknowledged,
                  onGuardAcknowledge: handleGuardAcknowledge,
                }
              : {})}
          />
        </div>
        {attachmentsEnabled.enabled &&
          attachments.filter((a) => a.status === 'ready').length > 0 && (
            <p className="mx-auto mt-1 w-full max-w-[608px] text-center text-[11px] text-muted-foreground">
              Reading:{' '}
              {attachments
                .filter((a) => a.status === 'ready')
                .map((a) => a.fileName)
                .join(', ')}
            </p>
          )}
        {disclaimer && (
          <p className="mx-auto mt-2 w-full max-w-[608px] text-center text-[11px] text-muted-foreground">
            {disclaimer}
          </p>
        )}
      </div>

      {/* Outside the transcript on purpose. It is full-bleed anyway, but the
          placement is what keeps a ring alive when the streaming row that
          opened it is rebuilt under a history key. */}
      {refiningList && (
        <ChatBoundaryDrawer
          list={refiningList}
          onClose={() => setRefiningList(null)}
        />
      )}
    </div>
  )
}
