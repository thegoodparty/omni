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
  ThinkingRow,
  UserBubble,
} from '../../../shared/agent-chat/chatUI'
import MessageActionBar from '../../../shared/agent-chat/MessageActionBar'
import { segmentsTextLength } from '../../../shared/agent-chat/streaming'
import {
  TurnBlocks,
  liveTurnBlocks,
  persistedTurnBlocks,
  type PositionedWidget,
} from '../../../shared/agent-chat/turnBlocks'
import { createWidgetRegistry } from '../../../shared/agent-chat/widgetRegistry'
import {
  cardWidgetTools,
  type CardWidgetContext,
} from '../../../shared/agent-chat/cards/cardWidgets'
import { ProposalFlowsProvider } from '../../../shared/agent-chat/cards/proposalFlows'
import {
  CardDetailProvider,
  CardDetailSheetHost,
} from '../../../shared/agent-chat/cards/cardDetail'
import {
  CLARIFY_TOOL,
  clarifyWidgetTool,
  type ClarifyWidgetContext,
} from '../../../shared/agent-chat/clarifyWidget'
import {
  composeHandoffWidgetTool,
  type ComposeHandoffWidgetContext,
} from '../../../shared/agent-chat/composeHandoffWidget'
import { useStreamingTurn } from '../../../shared/agent-chat/useStreamingTurn'
import { usePinnedAutoScroll } from '../../../shared/agent-chat/usePinnedAutoScroll'
import { useDictationAppend } from '../../../shared/dictation/useDictationAppend'
import { reportErrorToSentry } from '@shared/sentry'
import { useOrganization } from '@shared/organization-picker'
import { chiefOfStaffChatApi } from '../../data/chat-api'
import type {
  AgentChatClient,
  ChatMessageDto,
} from '../../../shared/agent-chat/chatClient'
import {
  COS_INTRO_MESSAGES,
  SAVED_FILTERS_TOOL,
  toolDisplayName,
} from './chatConstants'
import ChatHistoryPopover from './ChatHistoryPopover'
import { HISTORY_KEY, useChatHistory } from '../../data/use-chat-history'
import {
  ListProposalSchema,
  mintProposalKey,
  ShowListMapSchema,
  type ShowListMap,
  type ComposeHandoffPayload,
} from '@goodparty_org/contracts'
import type { ChatMessageSegment } from '../../../shared/agent-chat/chatTypes'
import ChatListMap from './ChatListMap'
import ChatListProposal, {
  type ChatListProposalPayload,
} from './ChatListProposal'
import { listCreatedMessage } from './listCreatedMessage'
import ChatBoundaryDrawer from './ChatBoundaryDrawer'
import { boundarySavedMessage } from './boundarySavedMessage'
import { supportsAttachments } from '../../../shared/agent-chat/attachmentScopes'
import type { ChatScope } from '../../../shared/agent-chat/chatClient'
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
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

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
  /**
   * One-shot VISIBLE opening message: the user already typed their request
   * somewhere else (the contacts assistant bar) and the surface opens onto
   * the answer, so it renders as their own bubble and persists as a normal
   * user turn. Composes with `pendingKickoff` (each effect leaves its ref
   * unlatched when it bails on an in-flight stream, so the message lands
   * after the kickoff's reply settles) but costs a second LLM turn to do it —
   * a surface with a request already in hand should send only this.
   */
  pendingMessage?: string
  /**
   * Fires once per VISIBLE message the user sends — the composer, a quick
   * prompt, a `pendingMessage`, a retry of one. Not for hidden kickoffs or
   * sentinels, which the user never typed. The contacts entry point counts
   * these for its open-to-send funnel (ENG-10767).
   */
  onMessageSent?: () => void
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
  /**
   * Which assistant this body talks to. Defaults to 'chief_of_staff' so
   * existing CoS callers need no change; Campaign Manager passes
   * 'campaign_assistant'.
   */
  scope?: ChatScope
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

// Per scope, so seeing one assistant's intro never suppresses the other's.
// Chief of Staff keeps its original key so officials who already saw it are
// not shown it again.
const introSeenKey = (scope: ChatScope): string =>
  scope === 'chief_of_staff' ? 'cos-intro-streamed' : `${scope}-intro-streamed`

// Stable default so callers that omit the prop keep the same array identity
// across renders (no needless re-run of the load effect).
const NO_HIDDEN_CONTENTS: string[] = []

// Starter prompts shown on a fresh chat; tapping one sends it.
const CHAT_SUGGESTIONS = [
  "What's most urgent this week?",
  'How many of my constituents are homeowners?',
  'What are constituents saying?',
]

// The first-attach safety notice, keyed by scope: Chief of Staff and Campaign
// Manager handle different kinds of sensitive material, so each gets its own
// toast copy and its own once-per-browser storage key.
const UPLOAD_GUARD_COPY: Record<
  'chief_of_staff' | 'campaign_assistant',
  { key: string; message: string }
> = {
  chief_of_staff: {
    key: 'serve-chat-attachments-guard',
    message:
      "Don't upload closed-session, privileged, or active-litigation material.",
  },
  campaign_assistant: {
    key: 'win-chat-attachments-guard',
    // chief-of-staff/ is Serve-only by convention, but Campaign Manager
    // mounts this same body under campaign_assistant, so this branch is
    // read only by a Win candidate.
    message:
      "Don't upload voter files, donor records, or anything you're not allowed to share.", // serve-vocabulary-allow: Win copy in a Serve-only-by-convention file
  },
}

/**
 * The reusable Chief of Staff chat surface body — separate from the briefing
 * `AskAiChatBody`. Streaming, smooth reveal, inline tool pills, and the
 * persisted-history handoff come from the shared agent-chat kit
 * (useStreamingTurn + chatUI); this component adds the CoS chrome: a typed
 * intro on first open, a typed-in seeded greeting, deferred conversation
 * creation, hidden kickoffs, starter chips, and quick prompts.
 */
const LIST_MAP_TOOL = 'show_list_map'
// Off the widget registry for the map's reason: once its list is created the
// card becomes that map, which renders after the turn's prose.
const LIST_PROPOSAL_TOOL = 'present_list_proposal'

type CosWidgetContext = CardWidgetContext &
  ClarifyWidgetContext &
  ComposeHandoffWidgetContext

// show_list_map is deliberately not here: its map renders after the turn's
// prose, once per turn, and moving it would change where it appears.
const cosWidgets = createWidgetRegistry<CosWidgetContext>([
  ...cardWidgetTools,
  clarifyWidgetTool,
  composeHandoffWidgetTool,
])

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

// The key is derived from the conversation and the tool call, so the card
// asks after the same list on every reload without the model writing it.
const listProposalFromSegments = (
  segments: ChatMessageSegment[],
  conversationId: string | null,
): ChatListProposalPayload | null => {
  const segment = segments.find((s) => s.toolName === LIST_PROPOSAL_TOOL)
  if (!segment?.toolCallId || !conversationId) return null
  const parsed = ListProposalSchema.safeParse(segment.payload)
  return parsed.success
    ? {
        ...parsed.data,
        proposalKey: mintProposalKey(conversationId, segment.toolCallId),
      }
    : null
}

// Chief of Staff has no rail of its own, so a card's detail opens in the
// right-side sheet the contacts page uses for a person.
const ChiefOfStaffChatBody = (props: Props): React.JSX.Element => (
  <CardDetailProvider>
    <ProposalFlowsProvider
      mode={props.scope === 'campaign_assistant' ? 'win' : 'serve'}
    >
      <ChiefOfStaffChatThread {...props} />
    </ProposalFlowsProvider>
    <CardDetailSheetHost />
  </CardDetailProvider>
)

export default ChiefOfStaffChatBody

function ChiefOfStaffChatThread({
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
  pendingMessage,
  onMessageSent,
  composerRef,
  disclaimer,
  hiddenMessageContents = NO_HIDDEN_CONTENTS,
  showMessageActions = false,
  scope = 'chief_of_staff',
}: Props): React.JSX.Element {
  const router = useRouter()
  const queryClient = useQueryClient()
  const orgSlug = useOrganization()?.slug
  const cardMode = scope === 'campaign_assistant' ? 'win' : 'serve'
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
  const [liveListProposal, setLiveListProposal] =
    useState<ChatListProposalPayload | null>(null)
  const [liveWidgets, setLiveWidgets] = useState<
    PositionedWidget<CosWidgetContext>[]
  >([])
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
  // The turn a saved boundary owes the conversation, held until the stream it
  // may have been drawn during finishes. See the effect that drains it.
  const [pendingBoundaryNote, setPendingBoundaryNote] = useState<string | null>(
    null,
  )
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
  // Same value-guard rationale as kickedOffRef: the parent clears the pending
  // message on close and may re-set the same text on reopen.
  const sentPendingRef = useRef<string | undefined>(undefined)
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null)
  const assignComposerRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      composerInputRef.current = node
      if (composerRef) composerRef.current = node
    },
    [composerRef],
  )

  const attachmentsEnabled = supportsAttachments(scope)

  const [attachments, setAttachments] = useState<ChatAttachmentState[]>([])

  // The safety notice fires as a toast after the first successful attach,
  // once per user (per browser). localStorage failure means the toast repeats
  // on later attaches, which errs toward showing the notice. Falls back to the
  // Chief of Staff copy for a scope with no attachment support at all (where
  // attachmentsEnabled is already false, so this never fires).
  const guardCopy =
    scope === 'campaign_assistant'
      ? UPLOAD_GUARD_COPY.campaign_assistant
      : UPLOAD_GUARD_COPY.chief_of_staff
  const maybeShowUploadGuard = useCallback((): void => {
    try {
      if (window.localStorage.getItem(guardCopy.key) === '1') return
      window.localStorage.setItem(guardCopy.key, '1')
    } catch {
      // private mode / storage disabled
    }
    toast(guardCopy.message)
    void trackEvent(EVENTS.ChiefOfStaff.UploadGuardShown, { scope })
  }, [guardCopy, scope])

  const reportedFailedIdsRef = useRef(new Set<string>())
  useEffect(() => {
    for (const attachment of attachments) {
      if (
        attachment.status === 'failed' &&
        !reportedFailedIdsRef.current.has(attachment.id)
      ) {
        reportedFailedIdsRef.current.add(attachment.id)
        void trackEvent(EVENTS.ChiefOfStaff.SourceUnreachablePromptShown, {
          promptContext: attachment.failureReason ?? 'unknown',
          scope,
        })
      }
    }
  }, [attachments, scope])

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
        setLiveListProposal(null)
        setLiveWidgets([])
      },
      // Cleared on settle as well as on start. The commit empties
      // liveSegments and swaps in the persisted transcript, whose segment
      // carries this same payload — so holding the live copy any longer
      // renders the card twice, once in the streaming row and once in
      // history, until the next message happens to clear it.
      onTurnSettle: () => {
        setLiveListMap(null)
        setLiveListProposal(null)
        setLiveWidgets([])
      },
      onError: (message, retryable) => setStreamError({ message, retryable }),
      onEvent: (event, { textLength, conversationId: turnConversationId }) => {
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
        if (
          event.type === 'tool_call' &&
          event.toolName === LIST_PROPOSAL_TOOL
        ) {
          const parsed = ListProposalSchema.safeParse(event.args)
          if (parsed.success && event.toolCallId && turnConversationId) {
            setLiveListProposal({
              ...parsed.data,
              proposalKey: mintProposalKey(
                turnConversationId,
                event.toolCallId,
              ),
            })
          }
          return true
        }
        if (event.type === 'tool_call' && cosWidgets.has(event.toolName)) {
          const instance = cosWidgets.resolve(
            {
              toolName: event.toolName,
              conversationId: turnConversationId,
              toolCallId: event.toolCallId ?? null,
            },
            event.args,
          )
          if (instance) {
            const at = textLength()
            setLiveWidgets((prev) => [
              ...prev,
              {
                key: `${event.toolName}-${event.toolCallId ?? prev.length}`,
                instance,
                appearAfter: at,
              },
            ])
            return true
          }
          // read_past_outreach is only sometimes a card; unparsed, it is a pill.
          return cosWidgets.entry(event.toolName)?.onParseFailure !== 'inline'
        }
        // A finished crud_saved_filters call may have written a saved list.
        // This lives here rather than on the contacts page because the agent
        // can cut a list from any surface that mounts this body, and the
        // map card right above reads `list-people` itself. Keys must match
        // ContactsTableProvider (['custom-segments', orgSlug]),
        // useListRowDetail (['list-detail', orgSlug, id]) and
        // listPeopleQueryKey (['list-people', orgSlug, segment]) exactly.
        if (
          event.type === 'tool_result' &&
          event.toolName === SAVED_FILTERS_TOOL
        ) {
          void queryClient.invalidateQueries({
            queryKey: ['custom-segments', orgSlug],
          })
          void queryClient.invalidateQueries({
            queryKey: ['list-detail', orgSlug],
          })
          // The map reads the list's members, not its summary, so it needs
          // its own key dropped or it keeps drawing the pre-edit set.
          void queryClient.invalidateQueries({
            queryKey: ['list-people', orgSlug],
          })
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
    if (!attachmentsEnabled) return
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
            surface: analyticsLabel,
            phase: 'attachment-poll',
          })
        })
    }, 3000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [attachmentsEnabled, conversationId, hasPending, analyticsLabel])

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
            surface: analyticsLabel,
            phase: 'attachment-delete',
          })
        }
      }
    },
    [conversationId, analyticsLabel],
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
        seen = window.localStorage.getItem(introSeenKey(scope)) === '1'
      } catch {
        seen = false
      }
      if (seen) return
    }

    const step = Math.max(2, Math.ceil(introTotal / 120))
    const id = setInterval(() => {
      if (!isOpener) {
        try {
          window.localStorage.setItem(introSeenKey(scope), '1')
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
  }, [opener, isFirstChat, introTotal, scope])

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
        surface: analyticsLabel,
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
        surface: analyticsLabel,
        phase: 'init',
      })
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
    historyKey,
    analyticsLabel,
  ])

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
        // The status poll can land between finalize and this line and already
        // hold the server row, so mapping the temp onto it would show it twice.
        setAttachments((prev) =>
          prev.some((a) => a.id === result.id)
            ? prev.filter((a) => a.id !== tempId)
            : prev.map((a) => (a.id === tempId ? result : a)),
        )
        maybeShowUploadGuard()
        void trackEvent(EVENTS.ChiefOfStaff.DocumentAttached, {
          sourceType: 'file',
          fileType: file.type || (file.name.split('.').pop() ?? ''),
          byteSize: file.size,
          pageCount: result.pageCount ?? null,
          scope,
        })
      } catch (err) {
        reportErrorToSentry(err, {
          surface: analyticsLabel,
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
    [
      conversationId,
      ensureConversationId,
      maybeShowUploadGuard,
      scope,
      analyticsLabel,
    ],
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
      let linkHost = ''
      try {
        linkHost = new URL(url).hostname
      } catch {
        // malformed url — leave linkHost as empty string
      }
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
          maybeShowUploadGuard()
          void trackEvent(EVENTS.ChiefOfStaff.LinkSubmitted, {
            linkHost,
            fetchSucceeded: true,
            scope,
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
          void trackEvent(EVENTS.ChiefOfStaff.LinkFetchFailed, {
            linkHost,
            failureReason: result.error,
            scope,
          })
        }
      } catch (err) {
        reportErrorToSentry(err, {
          surface: analyticsLabel,
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
        void trackEvent(EVENTS.ChiefOfStaff.LinkFetchFailed, {
          linkHost,
          failureReason: 'network_error',
          scope,
        })
      }
    },
    [
      conversationId,
      ensureConversationId,
      maybeShowUploadGuard,
      scope,
      analyticsLabel,
    ],
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
      if (!attachmentsEnabled || !dragHasFiles(e)) return
      e.preventDefault()
      dragDepthRef.current += 1
      setDragActive(true)
    },
    [attachmentsEnabled],
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent): void => {
      if (!attachmentsEnabled || !dragHasFiles(e)) return
      // preventDefault is what makes the surface a valid drop target.
      e.preventDefault()
    },
    [attachmentsEnabled],
  )

  const handleDragLeave = useCallback((e: React.DragEvent): void => {
    if (!dragHasFiles(e)) return
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragActive(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent): void => {
      if (!attachmentsEnabled) return
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
    [attachmentsEnabled, handleAttachFile],
  )

  const handleCitationClick = useCallback(
    async (
      attachmentId: string,
      page: number | null | undefined,
    ): Promise<void> => {
      if (!conversationId) return
      void trackEvent(EVENTS.ChiefOfStaff.CitationOpened, {
        documentId: attachmentId,
        pageNumber: page ?? null,
        scope,
      })
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
    [conversationId, scope],
  )

  // This body is shared by Serve's Chief of Staff and Win's Campaign Manager,
  // so a handoff routes on the payload's own channel rather than which
  // surface mounted it. serve_social keeps the original route (Serve users
  // are elected officials: /dashboard/outreach is the Win hub behind
  // candidateAccess() and bounces them to the marketing site). The nonce is
  // written to sessionStorage so the payload survives the navigation without
  // riding the URL (which would expose the draft text).
  const handleComposeHandoff = useCallback(
    (payload: ComposeHandoffPayload): void => {
      const prefilledFields: string[] = [
        'draftText',
        ...(payload.purpose ? ['purpose'] : []),
      ]
      void trackEvent(EVENTS.ChiefOfStaff.ComposeHandoffOpened, {
        channel: payload.channel,
        prefilledFields,
        scope,
      })
      let nonce: string
      try {
        nonce = crypto.randomUUID()
        sessionStorage.setItem(`cos-handoff-${nonce}`, JSON.stringify(payload))
      } catch {
        // sessionStorage unavailable (private browsing, quota exceeded):
        // navigate without prefill rather than failing the handoff entirely.
        router.push(
          payload.channel === 'win_social'
            ? '/dashboard/outreach?compose=social&source=campaign_manager'
            : '/dashboard/constituent-outreach',
        )
        return
      }
      router.push(
        payload.channel === 'win_social'
          ? `/dashboard/outreach?compose=social&source=campaign_manager&handoff=${nonce}`
          : `/dashboard/constituent-outreach?compose=social&handoff=${nonce}`,
      )
    },
    [router, scope],
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
        // After the `!id` guard, not before it: a failed conversation create
        // returns null and bails above, and counting that as a sent message
        // would overstate the very open-to-send funnel this callback exists
        // to measure (ENG-10767).
        onMessageSent?.()
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
    [
      sending,
      playback,
      ensureConversationId,
      send,
      setMessages,
      attachments,
      onMessageSent,
    ],
  )

  // The one thing that tells the conversation a shape was drawn. The write
  // itself goes browser -> API and touches nothing the model can see, so
  // without this turn the next message arrives in the context that existed
  // before the holder drew and the assistant answers about the pre-boundary
  // list. Hidden, because the holder did not type it; persisted, because a
  // resumed conversation has to carry the same fact.
  const handleBoundarySaved = useCallback(
    ({ cleared }: { cleared: boolean }) => {
      if (!refiningList) return
      setPendingBoundaryNote(
        boundarySavedMessage({
          listId: refiningList.listId,
          name: refiningList.name,
          cleared,
        }),
      )
    },
    [refiningList],
  )

  // Same queue as a drawn boundary, for the same reason: the card's write
  // touches nothing the model can see, and a list made while a turn is still
  // streaming must not lose the only turn that says it exists.
  const handleListCreated = useCallback((list: ShowListMap) => {
    setPendingBoundaryNote(listCreatedMessage(list))
  }, [])

  // Queued rather than sent, because a boundary can be saved while a turn is
  // still streaming — the drawer is mounted by this component precisely so it
  // survives that — and `deliver` refuses a send with one in flight. Dropping
  // it there would lose the model's only signal that a shape exists, and the
  // holder would get the pre-boundary answer back with no way to tell why.
  // Same wait-it-out shape as the kickoff effect above.
  useEffect(() => {
    if (!pendingBoundaryNote) return
    if (loading || creatingRef.current || sending) return
    setPendingBoundaryNote(null)
    void deliver(pendingBoundaryNote, { hidden: true })
  }, [pendingBoundaryNote, loading, sending, deliver])

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

  // The visible twin of the kickoff effect: the contacts assistant bar takes
  // the user's first message before this surface is even open, so it arrives
  // as a prop instead of through the composer. Same guards for the same
  // reasons — wait out a load/create/in-flight stream so it appends to the
  // resolved conversation, and leave the ref unlatched when bailing so the
  // effect retries once `sending` clears.
  useEffect(() => {
    if (!pendingMessage) {
      sentPendingRef.current = undefined
      return
    }
    if (!active || sentPendingRef.current === pendingMessage) return
    if (loading || creatingRef.current || sending) return
    if (conversationIdOverride && conversationId !== conversationIdOverride) {
      return
    }
    sentPendingRef.current = pendingMessage
    void deliver(pendingMessage, { hidden: false })
  }, [
    active,
    pendingMessage,
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
    liveListProposal,
    liveWidgets,
  ])

  // `liveListMap` counts as something on screen. onEvent consumes the
  // show_list_map call, so a turn that draws a map and says nothing pushes no
  // segment at all — without this the thinking row would sit under a rendered
  // map until the commit poll landed.
  const working =
    sending &&
    visibleSegments.length === 0 &&
    liveWidgets.length === 0 &&
    !liveListMap &&
    !liveListProposal
  const liveBlocks = liveTurnBlocks(
    visibleSegments,
    liveWidgets,
    segmentsTextLength(visibleSegments),
  )

  // The question still waiting on an answer: the last assistant turn that
  // asked one, and only while nothing has been said since.
  const activeClarifyId = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      const message = visibleMessages[i]
      if (!message) continue
      if (message.role === 'user') return null
      if ((message.segments ?? []).some((s) => s.toolName === CLARIFY_TOOL)) {
        return message.id
      }
    }
    return null
  }, [visibleMessages])
  // An answer is the next thing the user said, so an answered question
  // reloads with that answer showing.
  const clarifyAnswerById = useMemo(() => {
    const answers: Record<string, string> = {}
    visibleMessages.forEach((message, index) => {
      if (message.role === 'user') return
      if (!(message.segments ?? []).some((s) => s.toolName === CLARIFY_TOOL)) {
        return
      }
      const reply = visibleMessages
        .slice(index + 1)
        .find((later) => later.role === 'user')
      if (reply) answers[message.id] = reply.content
    })
    return answers
  }, [visibleMessages])

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
        listProposal: listProposalFromSegments(
          m.segments ?? [],
          conversationId,
        ),
        // The map segment is dropped from the inline run, not just rendered
        // alongside it. Live, onEvent consumes the event so no pill is ever
        // built; on replay the segment is still in the transcript and would
        // project to a status pill reading `show_list_map` above the card it
        // already drew. The ordinance flow splits its present_* segments out
        // for the same reason.
        blocks:
          m.role === 'user'
            ? null
            : persistedTurnBlocks({
                registry: cosWidgets,
                segments: (m.segments ?? []).filter(
                  (s) =>
                    s.toolName !== LIST_MAP_TOOL &&
                    s.toolName !== LIST_PROPOSAL_TOOL,
                ),
                content: m.content,
                messageId: m.id,
                conversationId,
              }),
      })),
    [visibleMessages, conversationId],
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
          m.blocks === null ? (
            <UserBubble key={m.id}>{m.content}</UserBubble>
          ) : (
            <AssistantRow
              key={m.id}
              fullWidth={
                Boolean(m.listMap) ||
                Boolean(m.listProposal) ||
                m.blocks.some((b) => b.kind === 'widget')
              }
            >
              <TurnBlocks
                blocks={m.blocks}
                toolLabel={toolLabel}
                context={{
                  clarifyInteractive: m.id === activeClarifyId && !busy,
                  clarifyAnswer: clarifyAnswerById[m.id],
                  onClarifyAnswer: sendContent,
                  onComposeHandoff: handleComposeHandoff,
                }}
                onCitationClick={
                  attachmentsEnabled && conversationId
                    ? handleCitationClick
                    : undefined
                }
              />
              {m.listMap ? (
                <ChatListMap
                  {...m.listMap}
                  onRefineArea={refiningList ? undefined : setRefiningList}
                  mode={cardMode}
                />
              ) : null}
              {m.listProposal ? (
                <ChatListProposal
                  proposal={m.listProposal}
                  mode={cardMode}
                  onRefineArea={refiningList ? undefined : setRefiningList}
                  onCreated={handleListCreated}
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
        {visibleSegments.length > 0 ||
        liveWidgets.length > 0 ||
        liveListMap ||
        liveListProposal ? (
          <AssistantRow
            fullWidth={
              Boolean(liveListMap) ||
              Boolean(liveListProposal) ||
              liveWidgets.length > 0
            }
          >
            <TurnBlocks
              blocks={liveBlocks}
              toolLabel={toolLabel}
              context={{
                clarifyInteractive: false,
                onClarifyAnswer: sendContent,
                onComposeHandoff: handleComposeHandoff,
              }}
              onCitationClick={
                attachmentsEnabled && conversationId
                  ? handleCitationClick
                  : undefined
              }
            />
            {liveListMap ? (
              <ChatListMap
                {...liveListMap}
                onRefineArea={refiningList ? undefined : setRefiningList}
                mode={cardMode}
              />
            ) : null}
            {liveListProposal ? (
              <ChatListProposal
                proposal={liveListProposal}
                mode={cardMode}
                onRefineArea={refiningList ? undefined : setRefiningList}
                onCreated={handleListCreated}
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
            {...(attachmentsEnabled
              ? {
                  attachments,
                  onAttachFile: (file) => void handleAttachFile(file),
                  onAttachLink: (url) => void handleAttachLink(url),
                  onRemoveAttachment: (id) => void handleRemoveAttachment(id),
                }
              : {})}
          />
        </div>
        {attachmentsEnabled &&
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
          onSaved={handleBoundarySaved}
          mode={cardMode}
        />
      )}
    </div>
  )
}
