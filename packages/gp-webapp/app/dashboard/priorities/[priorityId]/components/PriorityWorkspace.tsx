'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Skeleton,
} from '@styleguide'
import { ListChecksIcon } from '@styleguide/components/ui/icons'
import {
  parsePriorityStatus,
  type ChatAnchor,
  type PriorityStatus,
} from '@goodparty_org/contracts'
import {
  AssistantRow,
  ChatComposer,
  ThinkingRow,
  UserBubble,
} from '../../../shared/agent-chat/chatUI'
import { segmentsTextLength } from '../../../shared/agent-chat/streaming'
import {
  TurnBlocks,
  liveTurnBlocks,
  persistedTurnBlocks,
  type PositionedWidget,
} from '../../../shared/agent-chat/turnBlocks'
import {
  createWidgetRegistry,
  type WidgetInstance,
} from '../../../shared/agent-chat/widgetRegistry'
import {
  cardWidgetTools,
  type CardWidgetContext,
} from '../../../shared/agent-chat/cards/cardWidgets'
import {
  ProposalFlowsProvider,
  useOnProposalSent,
} from '../../../shared/agent-chat/cards/proposalFlows'
import {
  isProposalSentMessage,
  proposalSentMessage,
} from '../../../shared/agent-chat/cards/proposalPresentation'
import {
  CardDetailProvider,
  CardDetailSheetHost,
} from '../../../shared/agent-chat/cards/cardDetail'
import {
  CLARIFY_TOOL,
  clarifyWidgetTool,
  type ClarifyWidgetContext,
} from '../../../shared/agent-chat/clarifyWidget'
import { useStreamingTurn } from '../../../shared/agent-chat/useStreamingTurn'
import { usePinnedAutoScroll } from '../../../shared/agent-chat/usePinnedAutoScroll'
import { useDictationAppend } from '../../../shared/dictation/useDictationAppend'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { priorityFlowChatApi } from '../data/chat-api'
import { fetchPriorityStatus } from '../data/priority-api'
import { replayStatusMarkers, segmentKey } from '../data/statusReplay'
import {
  STATUS_TOOL,
  applyStatusUpdate,
  parseStatusToolResult,
  parseStatusUpdate,
  type StepChange,
} from '../data/statusUpdates'
import { priorityToolLabel } from '../data/toolLabels'
import {
  AUTHORITY_TOOL,
  COMPARABLES_TOOL,
  CURRENT_LAW_TOOL,
  findingWidgetTools,
} from '../../../ordinances/components/stepWidgets'
import { PriorityStatusRail } from './PriorityStatusRail'
import { StatusChangeMarker } from './StatusChangeMarker'

// Hidden opener for a brand-new conversation, so the official arrives at a
// thread that has already started rather than an empty box. Filtered out of
// the transcript on both send and reload.
const KICKOFF =
  "Let's begin. Tell me where this stands and what we should work on first."

// While the model is still writing a card's arguments (tool_input_start, before
// the call lands), name what it is working on. Contact, outreach and list work
// can take a while, and with text already on screen the chat otherwise looks
// stalled. Same signal the ordinance chat uses; tools that end as a pill fall
// back to their pill label.
const GENERATING_LABELS: Record<string, string> = {
  [CLARIFY_TOOL]: 'Preparing your question...',
  present_outside_contact: 'Looking up who to contact...',
  present_outreach_proposal: 'Building the outreach...',
  present_constituents: 'Pulling the list...',
  present_contacts: 'Pulling the list...',
  present_past_outreach: "Checking what you've sent...",
  [STATUS_TOOL]: 'Updating where this stands...',
  web_search: 'Searching the web...',
  [COMPARABLES_TOOL]: 'Looking at what other places did...',
  [CURRENT_LAW_TOOL]: 'Reading the current code...',
  [AUTHORITY_TOOL]: 'Checking what you can do here...',
}

const FINDING_TOOLS = [COMPARABLES_TOOL, CURRENT_LAW_TOOL, AUTHORITY_TOOL]

// Leaving mid-turn aborts the stream, but the server finishes and saves the
// reply anyway. Coming back before it lands loads a transcript that ends on the
// official's turn, and no turn here is running to wait for it. Same budget as
// the shared engine's doneless commit poll: a turn can write for minutes.
const REPLY_POLL_MS = 2_000
const REPLY_POLL_MAX_TRIES = 90

type Phase = 'loading' | 'ready' | 'error'

type PriorityWidgetContext = CardWidgetContext & ClarifyWidgetContext

const priorityWidgets = createWidgetRegistry<PriorityWidgetContext>([
  ...cardWidgetTools,
  ...findingWidgetTools,
  clarifyWidgetTool,
])

// A status move is not a registry widget: what it shows is the change the
// rail went through, which lives in the surface's replay, not in the tool args.
const statusMarker = (
  changes: StepChange[],
): WidgetInstance<PriorityWidgetContext> => ({
  toolName: STATUS_TOOL,
  render: () => <StatusChangeMarker changes={changes} />,
})

const RAIL_TITLE = 'Where this stands'

type PriorityWorkspaceProps = {
  priorityId: string
  title: string
  description: string
  initialStatus: PriorityStatus
  initialNextAction: string | null
  initialCurrentStep: string | null
}

const PriorityWorkspaceBody = ({
  priorityId,
  title,
  description,
  initialStatus,
  initialNextAction,
  initialCurrentStep,
}: PriorityWorkspaceProps): React.JSX.Element => {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('loading')
  const [retryNonce, setRetryNonce] = useState(0)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [status, setStatus] = useState<PriorityStatus>(() =>
    parsePriorityStatus(initialStatus),
  )
  const [nextAction, setNextAction] = useState<string | null>(initialNextAction)
  // The live status, readable synchronously. Two status tool calls can land in
  // one tick, and the second has to merge onto the first rather than onto the
  // last rendered value.
  const statusRef = useRef<PriorityStatus>(status)
  const commitStatus = useCallback(
    (next: PriorityStatus, action: string | null): void => {
      statusRef.current = next
      setStatus(next)
      setNextAction(action)
    },
    [],
  )
  const [liveWidgets, setLiveWidgets] = useState<
    PositionedWidget<PriorityWidgetContext>[]
  >([])
  const [composer, setComposer] = useState('')
  const [streamError, setStreamError] = useState<string | null>(null)
  const [generatingTool, setGeneratingTool] = useState<string | null>(null)
  const [streamDone, setStreamDone] = useState(false)
  const [awaitingReply, setAwaitingReply] = useState(false)
  // A finding card can be the last thing in a turn, so the shimmer stays off
  // right after one lands and comes back with the agent's next tool.
  const [afterFinding, setAfterFinding] = useState(false)
  const dictation = useDictationAppend({
    value: composer,
    onChange: setComposer,
    analyticsLabel: 'priority-chat',
  })

  // The rail's source of truth once a turn is over. Applied optimistically
  // from the tool call, corrected by the tool result, and finally reconciled
  // against what the server actually stored — so an interrupted turn cannot
  // leave the rail claiming a move that was never written.
  const reconcile = useCallback(async (): Promise<void> => {
    const persisted = await fetchPriorityStatus(priorityId)
    if (!persisted) return
    commitStatus(persisted.status, persisted.nextAction)
  }, [priorityId, commitStatus])

  const {
    messages,
    setMessages,
    visibleSegments,
    liveSegments,
    sending,
    send: sendTurn,
  } = useStreamingTurn(priorityFlowChatApi, {
    toolLabel: priorityToolLabel,
    onTurnStart: () => {
      setStreamError(null)
      setLiveWidgets([])
      setGeneratingTool(null)
      setStreamDone(false)
      setAfterFinding(false)
    },
    onTurnSettle: () => {
      setLiveWidgets([])
      setGeneratingTool(null)
      setStreamDone(false)
      setAfterFinding(false)
      void reconcile()
    },
    onError: (message) => setStreamError(message),
    onEvent: (event, { textLength, conversationId: turnConversationId }) => {
      if (event.type === 'tool_input_start') {
        setGeneratingTool(event.toolName)
        setAfterFinding(false)
        return true
      }
      if (event.type === 'tool_call') {
        setGeneratingTool(null)
        setAfterFinding(FINDING_TOOLS.includes(event.toolName))
      }
      if (event.type === 'done') setStreamDone(true)
      if (event.type === 'tool_call' && event.toolName === STATUS_TOOL) {
        const update = parseStatusUpdate(event.args)
        if (!update) return true
        // The rail moves now, while the agent is still talking. That is most
        // of the feel, and the tool result a beat later corrects any drift.
        const applied = applyStatusUpdate(statusRef.current, update)
        commitStatus(applied.status, applied.nextAction)
        if (applied.changes.length > 0) {
          const at = textLength()
          setLiveWidgets((prev) => [
            ...prev,
            {
              key: `status-${event.toolCallId ?? prev.length}`,
              instance: statusMarker(applied.changes),
              appearAfter: at,
            },
          ])
        }
        return true
      }
      if (event.type === 'tool_result' && event.toolName === STATUS_TOOL) {
        const settled = parseStatusToolResult(event.result)
        if (settled) commitStatus(settled.status, settled.nextAction)
        return true
      }
      if (event.type === 'tool_call' && priorityWidgets.has(event.toolName)) {
        const instance = priorityWidgets.resolve(
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
        return (
          priorityWidgets.entry(event.toolName)?.onParseFailure !== 'inline'
        )
      }
      // Everything else — counts, saved lists, web search — falls through to
      // the shared pill treatment the other chats use.
      return false
    },
  })

  const send = useCallback(
    (content: string, opts?: { hidden?: boolean; idOverride?: string }) => {
      const id = opts?.idOverride ?? conversationId
      if (!id) return
      void sendTurn(id, content, { hidden: opts?.hidden })
    },
    [conversationId, sendTurn],
  )
  // An answer is input to the conversation, nothing more: it goes back as an
  // ordinary user turn, and the agent decides for itself whether it settles a
  // step and calls update_priority_status.
  const answerClarify = useCallback(
    (answer: string): void => {
      trackEvent(EVENTS.Priorities.MessageSent, { priorityId, via: 'clarify' })
      send(answer)
    },
    [send, priorityId],
  )
  const sendRef = useRef(send)
  useEffect(() => {
    sendRef.current = send
  }, [send])

  // Outreach a card opened was just sent. The server has already moved its
  // check to out, so the rail refetches; the agent hears it through a hidden
  // turn, sent once per proposal (the key it ends on survives a reload) and
  // held until any turn in flight is done.
  const pendingSent = useRef<string[]>([])
  const toldKeys = useRef(new Set<string>())
  const [sentTick, setSentTick] = useState(0)
  const messagesRef = useRef(messages)
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])
  useOnProposalSent(
    useCallback(
      (proposal) => {
        void reconcile()
        const content = proposalSentMessage(proposal)
        const told =
          toldKeys.current.has(proposal.proposalKey) ||
          messagesRef.current.some((m) =>
            m.content.includes(proposal.proposalKey),
          )
        if (told) return
        toldKeys.current.add(proposal.proposalKey)
        pendingSent.current.push(content)
        setSentTick((tick) => tick + 1)
      },
      [reconcile],
    ),
  )
  useEffect(() => {
    if (sending || awaitingReply || phase !== 'ready' || !conversationId) {
      return
    }
    const next = pendingSent.current.shift()
    if (next) send(next, { hidden: true })
  }, [sending, awaitingReply, phase, conversationId, sentTick, send])

  useEffect(() => {
    let cancelled = false
    const init = async (): Promise<void> => {
      try {
        const anchor: ChatAnchor = {
          resourceType: 'priority',
          resourceId: priorityId,
          url: `/dashboard/priorities/${priorityId}`,
          snapshot: { title, summary: description },
        }
        const { conversationId: id } =
          await priorityFlowChatApi.createConversation(anchor)
        const history = await priorityFlowChatApi.listMessages(id)
        if (cancelled) return
        setConversationId(id)
        setMessages(history)
        setPhase('ready')
        trackEvent(EVENTS.Priorities.PriorityViewed, {
          priorityId,
          currentStep: initialCurrentStep,
          isNewConversation: history.length === 0,
        })
        if (history.length === 0) {
          sendRef.current(KICKOFF, { hidden: true, idOverride: id })
          return
        }
        if (history[history.length - 1]?.role !== 'user') return
        setAwaitingReply(true)
        let latest = history
        try {
          for (
            let tries = 0;
            tries < REPLY_POLL_MAX_TRIES &&
            latest[latest.length - 1]?.role === 'user';
            tries++
          ) {
            await new Promise((resolve) => setTimeout(resolve, REPLY_POLL_MS))
            if (cancelled) return
            latest = await priorityFlowChatApi.listMessages(id)
            if (cancelled) return
          }
          setMessages(latest)
        } catch {
          // The transcript already on screen stays; the composer reopens.
        } finally {
          if (!cancelled) setAwaitingReply(false)
        }
      } catch {
        if (!cancelled) setPhase('error')
      }
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [
    priorityId,
    title,
    description,
    initialCurrentStep,
    setMessages,
    retryNonce,
  ])

  const markers = useMemo(() => replayStatusMarkers(messages), [messages])
  // The question still waiting on an answer: the last assistant turn that
  // asked one, and only while nothing has been said since. An answer is an
  // ordinary user turn, so a user turn after the question is the answer.
  const activeClarifyId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (!message) continue
      if (message.role === 'user') return null
      if ((message.segments ?? []).some((s) => s.toolName === CLARIFY_TOOL)) {
        return message.id
      }
    }
    return null
  }, [messages])
  // Priorities keeps no separate answer record: an answer is the next thing the
  // official said, so derive it from the transcript. Without this, a question
  // answered in an earlier session reloads locked with nothing highlighted.
  const clarifyAnswerById = useMemo(() => {
    const answers: Record<string, string> = {}
    messages.forEach((message, index) => {
      if (message.role === 'user') return
      if (!(message.segments ?? []).some((s) => s.toolName === CLARIFY_TOOL)) {
        return
      }
      const reply = messages
        .slice(index + 1)
        .find(
          (later) =>
            later.role === 'user' &&
            later.content !== KICKOFF &&
            !isProposalSentMessage(later.content),
        )
      if (reply) answers[message.id] = reply.content
    })
    return answers
  }, [messages])
  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (m) =>
          !(
            m.role === 'user' &&
            (m.content === KICKOFF || isProposalSentMessage(m.content))
          ),
      ),
    [messages],
  )

  const { scrollRef, onScroll } = usePinnedAutoScroll([
    messages,
    visibleSegments,
    liveWidgets,
  ])

  const revealedTextLength = segmentsTextLength(visibleSegments)
  const blocks = liveTurnBlocks(
    visibleSegments,
    liveWidgets,
    revealedTextLength,
  )
  // Hold the shimmer until something has actually painted, so there is no
  // empty flash between "Thinking..." and the first word. After that it
  // comes back whenever the agent is working with nothing moving on screen:
  // between tool calls, and while a card's arguments stream in. Gated on the
  // reveal catching up so it never sits under text still typing out, off
  // while a tool's own pill is shimmering, and off once the stream is done:
  // the turn can stay sending while it commits, and a shimmer under a
  // finished question reads as more coming.
  const revealDone = revealedTextLength >= segmentsTextLength(liveSegments)
  const pillRunning = liveSegments.some(
    (segment) => segment.kind === 'tool' && segment.running,
  )
  // A question card ends the turn, so nothing more is coming once it is up.
  const clarifyLive = liveWidgets.some(
    (widget) => widget.instance.toolName === CLARIFY_TOOL,
  )
  const working =
    awaitingReply ||
    (sending &&
      !clarifyLive &&
      !afterFinding &&
      (blocks.length === 0 || (revealDone && !pillRunning && !streamDone)))
  const pillLabel = generatingTool ? priorityToolLabel(generatingTool) : null
  const workingLabel =
    (generatingTool && GENERATING_LABELS[generatingTool]) ||
    (pillLabel ? `${pillLabel}...` : 'Thinking...')

  if (phase === 'error') {
    return (
      <div className="flex h-[calc(100dvh-4rem)] w-full flex-col items-center justify-center gap-4 bg-background p-6 text-center lg:h-dvh">
        <p className="text-tertiary">
          We couldn&apos;t open this priority. That is usually temporary.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            className="rounded-full"
            onClick={() => {
              setPhase('loading')
              setRetryNonce((n) => n + 1)
            }}
          >
            Try again
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            onClick={() => router.push('/dashboard/priorities')}
          >
            Back to priorities
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100dvh-4rem)] w-full bg-background lg:h-dvh">
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
            <header className="flex items-start justify-between gap-3">
              <h1 className="text-xl font-semibold text-foreground">{title}</h1>
              <Sheet>
                <SheetTrigger asChild>
                  <Button
                    variant="outline"
                    size="small"
                    className="shrink-0 gap-1.5 lg:hidden"
                  >
                    <ListChecksIcon className="size-4" aria-hidden />
                    {RAIL_TITLE}
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="max-h-[85dvh]">
                  <SheetHeader>
                    <SheetTitle>{RAIL_TITLE}</SheetTitle>
                  </SheetHeader>
                  <SheetBody>
                    <PriorityStatusRail
                      status={status}
                      nextAction={nextAction}
                      className="border-0 shadow-none"
                    />
                  </SheetBody>
                </SheetContent>
              </Sheet>
            </header>

            {phase === 'loading' ? (
              <div className="flex flex-col gap-3" aria-busy="true">
                <div className="flex items-start gap-2">
                  <Skeleton className="size-6 shrink-0 rounded-full" />
                  <Skeleton className="h-20 w-80 max-w-full rounded-2xl" />
                </div>
                <div className="flex items-start gap-2">
                  <Skeleton className="size-6 shrink-0 rounded-full" />
                  <Skeleton className="h-12 w-64 max-w-full rounded-2xl" />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {visibleMessages.map((message) =>
                  message.role === 'user' ? (
                    <UserBubble key={message.id}>{message.content}</UserBubble>
                  ) : (
                    <AssistantRow key={message.id} fullWidth>
                      <TurnBlocks
                        blocks={persistedTurnBlocks({
                          registry: priorityWidgets,
                          messageId: message.id,
                          segments: message.segments ?? [],
                          content: message.content,
                          conversationId: conversationId ?? '',
                          surfaceWidget: (segment, index) => {
                            if (segment.toolName !== STATUS_TOOL) return null
                            const changes = markers.get(
                              segmentKey(message.id, index),
                            )
                            return changes && changes.length > 0
                              ? statusMarker(changes)
                              : null
                          },
                        })}
                        toolLabel={priorityToolLabel}
                        context={{
                          priorityId,
                          clarifyInteractive:
                            message.id === activeClarifyId && !sending,
                          clarifyAnswer: clarifyAnswerById[message.id],
                          onClarifyAnswer: answerClarify,
                        }}
                      />
                    </AssistantRow>
                  ),
                )}

                {blocks.length > 0 || working ? (
                  <AssistantRow fullWidth>
                    <TurnBlocks
                      blocks={blocks}
                      toolLabel={priorityToolLabel}
                      context={{
                        priorityId,
                        clarifyInteractive: false,
                        onClarifyAnswer: answerClarify,
                      }}
                    />
                    {working ? <ThinkingRow label={workingLabel} /> : null}
                  </AssistantRow>
                ) : null}

                {streamError ? (
                  <p className="text-sm text-destructive">{streamError}</p>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-background">
          <div className="mx-auto w-full max-w-3xl px-4 py-3">
            <ChatComposer
              value={composer}
              onChange={setComposer}
              onSubmit={() => {
                const text = composer
                setComposer('')
                trackEvent(EVENTS.Priorities.MessageSent, {
                  priorityId,
                  via: 'composer',
                })
                send(text)
              }}
              disabled={sending || awaitingReply || phase !== 'ready'}
              placeholder="Ask about this priority, or tell me what changed..."
              ariaLabel="Message about this priority"
              dictation={dictation}
            />
          </div>
        </div>
      </div>

      <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-border p-4 lg:block">
        <PriorityStatusRail status={status} nextAction={nextAction} />
      </aside>
      <CardDetailSheetHost />
    </div>
  )
}

export const PriorityWorkspace = (
  props: PriorityWorkspaceProps,
): React.JSX.Element => (
  <CardDetailProvider>
    <ProposalFlowsProvider>
      <PriorityWorkspaceBody {...props} />
    </ProposalFlowsProvider>
  </CardDetailProvider>
)
