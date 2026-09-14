'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@styleguide'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@styleguide/components/ui/icons'
import type { ChatAnchor, Priority } from '@goodparty_org/contracts'
import { toolDisplayName } from '../../chief-of-staff/components/chat/chatConstants'
import {
  ASSISTANT_BUBBLE,
  AssistantRow,
  ChatComposer,
  InlineSegments,
  ThinkingRow,
  UserBubble,
} from '../../shared/agent-chat/chatUI'
import { segmentsToLive } from '../../shared/agent-chat/streaming'
import type { ChatMessageDto } from '../../shared/agent-chat/chatTypes'
import {
  parseTurnText,
  splitSegments,
  type OutreachChannel,
  type OutreachOrg,
  type OutreachPlan,
  type PriorityDirective,
  type WaitingOn,
} from '../data/stepProtocol'
import PriorityQuestion from './PriorityQuestion'
import { usePinnedAutoScroll } from '../../shared/agent-chat/usePinnedAutoScroll'
import { useStreamingTurn } from '../../shared/agent-chat/useStreamingTurn'
import { priorityFlowChatApi } from '../data/chat-api'
import {
  buildOrgsPrompt,
  buildOutreachPrompt,
  buildResumePrompt,
  buildStepPrompt,
  stepFromMarker,
} from '../data/stepPrompts'
import {
  PRIORITY_FLOW_STEP_VALUES,
  PRIORITY_NEXT_STEP_CTA,
  PRIORITY_STEP_CAPTIONS,
  PRIORITY_STEP_LABELS,
  PRIORITY_STEP_SHORT_LABELS,
  nextPriorityStep,
  previousPriorityStep,
  type PriorityFlowStep,
} from '../data/steps'
import PriorityStepper from './PriorityStepper'

// The flow around one priority, in the ordinance flow's shell and running a
// real agent turn per step. Each step sends its ask hidden (see
// data/stepPrompts.ts) so the user sees an answer about THEIR priority rather
// than canned copy, and the composer is live for follow-ups.
//
// Step state lives here: the flow has no backend, so nothing is persisted and a
// reload starts the conversation over. Once gp-api owns the record, `step`
// becomes a route segment the way ordinances/solve/[slug]/[step] does.
// Which step a resumed conversation is on: the last step ask carries a marker
// (data/stepPrompts.ts), and the asks are hidden, so this is reading the
// flow's own footprints rather than guessing from the prose.
const resumedStep = (messages: ChatMessageDto[]): PriorityFlowStep | null => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!message || message.role !== 'user') continue
    const step = stepFromMarker(message.content, PRIORITY_FLOW_STEP_VALUES)
    if (step) return step
  }
  return null
}

// What the priority stopped on, if it stopped waiting for the world. Only the
// last assistant turn counts: an older wait has already been picked back up.
const resumedWaiting = (messages: ChatMessageDto[]): WaitingOn | null => {
  const assistant = messages.filter((m) => m.role === 'assistant')
  const last = assistant[assistant.length - 1]
  if (!last) return null
  const directive = parseTurnText(last.content).directive
  return directive?.kind === 'waiting' ? directive.waiting : null
}

// The outreach channels this flow can hand off to, named the way the
// Constituent Outreach hub names them.
const CHANNEL_LABELS: Record<OutreachChannel, string> = {
  phone_banking: 'Phone banking',
  social: 'Social media',
}

export default function PriorityFlowShell({
  priority,
  issues,
}: {
  priority: Priority
  // Community issues on file for the district, handed to the research steps so
  // the agent can read them rather than starting from a web search.
  issues: { id: string; title: string }[]
}): React.JSX.Element {
  const router = useRouter()
  const [step, setStep] = useState<PriorityFlowStep>('define')
  const [composer, setComposer] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  // False once the API has refused the priority anchor, which means its prompt
  // does not know about this flow and the step asks have to say so themselves.
  const [anchorAccepted, setAnchorAccepted] = useState(true)
  // The transcript this priority already has: null until it has been read,
  // empty for a conversation that is genuinely new.
  const [resumed, setResumed] = useState<ChatMessageDto[] | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  // The step asks are sent hidden, so their persisted user turns have to be
  // dropped from the transcript by content — the engine reconciles against the
  // raw server history, which includes them.
  const [hiddenSent, setHiddenSent] = useState<string[]>([])
  // Answers to the step questions, keyed by the turn that asked. An answered
  // widget locks and keeps the choice highlighted, the way the ordinance
  // flow's clarify widget does.
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const creatingRef = useRef(false)

  const toolLabel = useCallback((name: string): string => {
    return toolDisplayName(name)
  }, [])

  const { messages, setMessages, visibleSegments, sending, send, isStreaming } =
    useStreamingTurn(priorityFlowChatApi, {
      toolLabel,
      onTurnStart: () => setStreamError(null),
      onError: (message) => setStreamError(message),
    })

  const askStep = useCallback(
    (target: PriorityFlowStep, id: string): void => {
      const prompt = buildStepPrompt(target, priority, issues, {
        declareFlowContext: !anchorAccepted,
      })
      setHiddenSent((prev) => [...prev, prompt])
      void send(id, prompt, { hidden: true })
    },
    [priority, issues, anchorAccepted, send],
  )
  // Held in a ref so the bootstrap effects don't take it as a dependency.
  const askStepRef = useRef(askStep)
  useEffect(() => {
    askStepRef.current = askStep
  }, [askStep])

  // One conversation per priority, resumed rather than recreated: the work
  // spans days and some of it waits on a meeting, so re-asking the same
  // questions on every visit is the thing this has to avoid. gp-api
  // find-or-creates on the anchor's resourceId, so the create call is also
  // the resume call.
  useEffect(() => {
    if (creatingRef.current) return
    creatingRef.current = true
    void (async () => {
      const anchor: ChatAnchor = {
        resourceType: 'priority',
        resourceId: priority.id,
        url: `/dashboard/priorities/${priority.id}`,
        snapshot: {
          title: priority.title,
          summary: priority.description,
        },
        step: 'define',
      }
      const open = async (): Promise<string | null> => {
        try {
          const { conversationId: id } =
            await priorityFlowChatApi.createConversation(anchor)
          return id
        } catch {
          // An API that predates the priority anchor. No resume from here:
          // an unanchored conversation cannot be found again.
          try {
            const { conversationId: id } =
              await priorityFlowChatApi.createConversation()
            setAnchorAccepted(false)
            return id
          } catch {
            return null
          }
        }
      }
      const id = await open()
      if (!id) {
        setStartError(
          "We couldn't start work on this priority. Please try again.",
        )
        return
      }
      setConversationId(id)
      try {
        const prior = await priorityFlowChatApi.listMessages(id)
        if (prior.length > 0) setMessages(prior)
        setResumed(prior)
      } catch {
        // A transcript we cannot read is a fresh start, not a dead end.
        setResumed([])
      }
    })()
  }, [priority, setMessages])

  // With a transcript in hand: a fresh conversation gets the first step's ask,
  // a resumed one gets picked up where it stopped. Nothing is re-asked.
  const kickedOffRef = useRef(false)
  useEffect(() => {
    if (!conversationId || resumed === null || kickedOffRef.current) return
    kickedOffRef.current = true

    if (resumed.length === 0) {
      askStepRef.current('define', conversationId)
      return
    }

    const lastStep = resumedStep(resumed)
    if (lastStep) setStep(lastStep)

    // The point of having recorded it: if the last thing this priority did was
    // wait on something outside the app, open by asking how that went.
    const pending = resumedWaiting(resumed)
    if (pending) {
      const prompt = buildResumePrompt(pending.on)
      setHiddenSent((prev) => [...prev, prompt])
      void send(conversationId, prompt, { hidden: true })
    }
  }, [conversationId, resumed, send])

  // Going back re-opens the previous step rather than scrolling to it: the
  // point of revisiting is usually that something has changed, and the agent
  // has the whole conversation to pick it up from.
  const goToStep = (target: PriorityFlowStep): void => {
    if (isStreaming() || !conversationId || target === step) return
    setStep(target)
    askStep(target, conversationId)
  }

  const previousStep = previousPriorityStep(step)

  const advance = (destination: PriorityFlowStep): void => {
    if (isStreaming() || !conversationId) return
    setStep(destination)
    askStep(destination, conversationId)
  }

  const hiddenContent = useMemo(() => new Set(hiddenSent), [hiddenSent])
  const visibleMessages = useMemo(
    () => messages.filter((m) => !hiddenContent.has(m.content)),
    [messages, hiddenContent],
  )

  const { scrollRef, onScroll } = usePinnedAutoScroll([
    visibleMessages,
    visibleSegments,
  ])

  const destination = nextPriorityStep(step)
  const liveSplit = useMemo(
    () => splitSegments(visibleSegments),
    [visibleSegments],
  )
  const assistantTurns = visibleMessages.filter((m) => m.role === 'assistant')
  const latestAssistant = assistantTurns[assistantTurns.length - 1]
  const latestAssistantId = latestAssistant?.id ?? null
  // The step advances only once the agent says it is settled, which is this
  // flow's offer_next_step: a step that is still asking does not get a
  // Continue button.
  const latestDirective: PriorityDirective | null = latestAssistant
    ? splitSegments(
        segmentsToLive(latestAssistant.segments ?? [], latestAssistant.content),
      ).directive
    : null
  // The most recent summary, which the follow-up beats quote back so the
  // agent stays on the same thread.
  const lastSettledText = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
      const message = visibleMessages[i]
      if (!message || message.role !== 'assistant') continue
      const directive = parseTurnText(message.content).directive
      if (directive?.kind === 'synthesis') return directive.settled
    }
    return null
  }, [visibleMessages])

  const latestOutreach =
    latestAssistant && latestDirective?.kind === 'outreach'
      ? { id: latestAssistant.id, settled: lastSettledText ?? '' }
      : null

  // Continue appears once the last beat has landed. A step still asking, or
  // parked on the real world, or halfway through its beats, does not get one:
  // the organizations are part of the step, not an optional extra after it.
  const settled = latestDirective?.kind === 'orgs'
  // A settle turn can run for the better part of a minute: dimensions, a
  // count, a list create, then research. The tool pills shimmer while a tool
  // is actually in flight, but the gaps between them (the model thinking, or
  // writing a long block the parser is holding back) were silent, and silence
  // reads as a hang. So something is always moving while the turn is open.
  const lastSegment = liveSplit.segments[liveSplit.segments.length - 1]
  const toolRunning = lastSegment?.kind === 'tool' && lastSegment.running
  const working = sending && !toolRunning
  const workingLabel =
    liveSplit.segments.length === 0 ? 'Thinking...' : 'Still working on it...'

  // The agent has already built the list and drafted the message, so this is
  // not permission to do the work: it is the official taking work that is
  // done. It opens the channel's own flow on the message to review.
  const openOutreach = (plan: OutreachPlan): void => {
    const params = new URLSearchParams({
      flow: plan.channel,
      message: plan.message,
    })
    if (plan.listId !== null) params.set('listId', String(plan.listId))
    if (plan.campaignName !== null) params.set('name', plan.campaignName)
    router.push(`/dashboard/constituent-outreach?${params.toString()}`)
  }

  const answerQuestion = (messageId: string, answer: string): void => {
    if (!conversationId || isStreaming()) return
    setAnswers((prev) => ({ ...prev, [messageId]: answer }))
    void send(conversationId, answer)
  }

  // Confirming the summary is what starts the outreach beat. Sent hidden and
  // by the client, because an agent asked to volunteer three turns in order
  // collapsed them into one, skipped the summary, and never reached the
  // organizations.
  const confirmSettled = (messageId: string, settled: string): void => {
    if (!conversationId || isStreaming()) return
    setAnswers((prev) => ({ ...prev, [messageId]: CONFIRM_YES }))
    const prompt = buildOutreachPrompt(settled)
    setHiddenSent((prev) => [...prev, prompt])
    void send(conversationId, prompt, { hidden: true })
  }

  // And the outreach landing is what starts the organizations beat, once per
  // turn that carried one.
  const orgsAskedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!conversationId || sending) return
    if (!latestOutreach || orgsAskedRef.current === latestOutreach.id) return
    orgsAskedRef.current = latestOutreach.id
    const prompt = buildOrgsPrompt(latestOutreach.settled)
    setHiddenSent((prev) => [...prev, prompt])
    void send(conversationId, prompt, { hidden: true })
  }, [conversationId, sending, latestOutreach, send])

  return (
    <div className="flex h-[calc(100dvh-4rem)] w-full flex-col bg-background lg:h-dvh">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
          <header className="flex flex-col gap-3">
            <PriorityStepper current={step} />
            <h1 className="text-xl font-semibold text-foreground">
              {priority.title}
            </h1>
            {previousStep ? (
              <Button
                type="button"
                size="small"
                variant="ghost"
                disabled={sending}
                onClick={() => goToStep(previousStep)}
                className="-ml-2 self-start text-sm font-normal text-muted-foreground"
              >
                <ChevronLeftIcon className="size-4" aria-hidden />
                Back to {PRIORITY_STEP_SHORT_LABELS[previousStep].toLowerCase()}
              </Button>
            ) : null}
          </header>

          <div className="flex flex-col gap-3">
            {/* The step's own question, which belongs to the flow rather than
                to the model — the agent answers it below. */}
            <AssistantRow>
              <div className={ASSISTANT_BUBBLE}>
                <p className="font-medium">{PRIORITY_STEP_LABELS[step]}</p>
                <p>{PRIORITY_STEP_CAPTIONS[step]}</p>
              </div>
            </AssistantRow>

            {visibleMessages.map((message) => {
              if (message.role === 'user') {
                return (
                  <UserBubble key={message.id}>{message.content}</UserBubble>
                )
              }
              const split = splitSegments(
                segmentsToLive(message.segments ?? [], message.content),
              )
              const isLatest = message.id === latestAssistantId
              return (
                <AssistantRow key={message.id}>
                  <InlineSegments
                    segments={split.segments}
                    toolLabel={toolLabel}
                  />
                  {split.directive?.kind === 'question' ? (
                    <PriorityQuestion
                      directive={split.directive}
                      {...(answers[message.id] !== undefined
                        ? { answer: answers[message.id] }
                        : {})}
                      // Only the newest question takes input; earlier ones
                      // render read-only in place.
                      disabled={sending || !isLatest}
                      onAnswer={(answer) => answerQuestion(message.id, answer)}
                    />
                  ) : null}
                  {split.directive?.kind === 'waiting' ? (
                    <WaitingCard waiting={split.directive.waiting} />
                  ) : null}
                  {split.directive?.kind === 'synthesis' ? (
                    <>
                      <SettledCard text={split.directive.settled} />
                      {/* Checking the summary before anything is built on it,
                          through the same picker every other question uses. */}
                      <PriorityQuestion
                        directive={CONFIRM_QUESTION}
                        {...(answers[`${message.id}:confirm`] !== undefined
                          ? { answer: answers[`${message.id}:confirm`] }
                          : {})}
                        disabled={sending || !isLatest}
                        onAnswer={(answer) => {
                          const key = `${message.id}:confirm`
                          if (
                            answer === CONFIRM_YES &&
                            split.directive?.kind === 'synthesis'
                          ) {
                            confirmSettled(key, split.directive.settled)
                            return
                          }
                          // Anything else is a correction: send it as a turn
                          // and let the agent re-settle.
                          answerQuestion(key, answer)
                        }}
                      />
                    </>
                  ) : null}
                  {split.directive?.kind === 'outreach' ? (
                    <OutreachCard
                      outreach={split.directive.outreach}
                      onOutreach={openOutreach}
                    />
                  ) : null}
                  {split.directive?.kind === 'orgs' ? (
                    <OrgsCard orgs={split.directive.orgs} />
                  ) : null}
                </AssistantRow>
              )
            })}

            {liveSplit.segments.length > 0 || working ? (
              <AssistantRow>
                {liveSplit.segments.length > 0 ? (
                  <InlineSegments
                    segments={liveSplit.segments}
                    toolLabel={toolLabel}
                  />
                ) : null}
                {working ? <ThinkingRow label={workingLabel} /> : null}
              </AssistantRow>
            ) : null}

            {startError ? (
              <p className="text-sm text-destructive">{startError}</p>
            ) : null}
            {streamError ? (
              <p className="text-sm text-destructive">{streamError}</p>
            ) : null}

            {settled && !sending && !startError ? (
              <NextStepRow
                label={
                  destination
                    ? PRIORITY_NEXT_STEP_CTA[destination]
                    : 'Back to your priorities'
                }
                onClick={() =>
                  destination
                    ? advance(destination)
                    : router.push('/dashboard/priorities')
                }
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-background">
        <div className="mx-auto w-full max-w-3xl px-4 py-3">
          <ChatComposer
            value={composer}
            onChange={setComposer}
            onSubmit={() => {
              if (!conversationId) return
              const text = composer
              setComposer('')
              void send(conversationId, text)
            }}
            disabled={sending || !conversationId}
            placeholder="Answer, or ask me anything about this priority..."
          />
        </div>
      </div>
    </div>
  )
}

// A step parked on the real world. Rendering it is half the point: the other
// half is that the flow reads it back on the next visit and opens by asking
// how it went.
function WaitingCard({ waiting }: { waiting: WaitingOn }): React.JSX.Element {
  return (
    <div className="flex w-full flex-col gap-1 rounded-lg border border-warning/40 bg-warning/5 p-4 shadow-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Waiting on
      </span>
      <p className="text-sm font-medium text-foreground">{waiting.on}</p>
      <p className="text-sm text-muted-foreground">{waiting.unblocks}</p>
      {waiting.when ? (
        <p className="text-sm text-muted-foreground">Expected {waiting.when}</p>
      ) : null}
    </div>
  )
}

// Beat one: what the step settled, on its own, so it can be checked before
// anything is built on it.
function SettledCard({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="flex w-full flex-col gap-1 rounded-lg border border-border bg-card p-4 shadow-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        What this step settled
      </span>
      <p className="text-sm text-foreground">{text}</p>
    </div>
  )
}

// The confirm, synthesized rather than asked for: the agent has already said
// what it thinks, and a round trip to have it write "is that right?" is a
// round trip the user waits through.
const CONFIRM_YES = 'Yes, that is it'

const CONFIRM_QUESTION: Extract<PriorityDirective, { kind: 'question' }> = {
  kind: 'question',
  ask: 'Have I got that right?',
  options: [CONFIRM_YES, 'Not quite'],
  notes: [],
}

// Beat two: the outreach, already built. Who it goes to, on what, saying
// what, and the one action that opens the channel's own flow.
function OutreachCard({
  outreach,
  onOutreach,
}: {
  outreach: OutreachPlan
  onOutreach: (plan: OutreachPlan) => void
}): React.JSX.Element {
  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Worth hearing from
        </span>
        <p className="text-sm font-medium text-foreground">
          {outreach.who}
          {outreach.count !== null
            ? ` (${outreach.count.toLocaleString()})`
            : ''}
        </p>
        <p className="text-sm text-muted-foreground">{outreach.why}</p>
      </div>
      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {CHANNEL_LABELS[outreach.channel]}
        </span>
        <p className="mt-1 text-sm text-foreground">{outreach.message}</p>
      </div>
      <Button
        size="small"
        className="self-start rounded-full"
        onClick={() => onOutreach(outreach)}
      >
        Reach out to them
      </Button>
      {outreach.listId === null ? (
        <span className="text-xs text-muted-foreground">
          You will pick who it goes to on the next screen.
        </span>
      ) : null}
    </div>
  )
}

// Beat three: the coalitions. A row each, because the detail (who to ask for,
// what to say, how to reach them) is what you want open in front of you when
// you actually make the call, not while you are reading past it.
function OrgsCard({ orgs }: { orgs: OutreachOrg[] }): React.JSX.Element {
  const [open, setOpen] = useState<OutreachOrg | null>(null)
  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Groups who reach further than your list
      </span>
      {orgs.map((org) => (
        <button
          key={org.name}
          type="button"
          onClick={() => setOpen(org)}
          className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-muted/50"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-foreground">
              {org.name}
            </span>
            <span className="block truncate text-sm text-muted-foreground">
              {org.why}
            </span>
          </span>
          <ChevronRightIcon
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </button>
      ))}
      <OrgSheet
        org={open}
        onOpenChange={(next) => {
          if (!next) setOpen(null)
        }}
      />
    </div>
  )
}

// The same shape as a contact card: who you are calling, what to ask for, the
// script, and the address or number as something you can actually press.
function OrgSheet({
  org,
  onOpenChange,
}: {
  org: OutreachOrg | null
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  return (
    <Sheet open={org !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{org?.name ?? ''}</SheetTitle>
          <SheetDescription>{org?.why ?? ''}</SheetDescription>
        </SheetHeader>
        {org ? (
          <SheetBody className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Ask for
              </span>
              <p className="text-sm text-foreground">{org.askFor}</p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                What to say
              </span>
              <p className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
                {org.script}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {org.email ? (
                <Button asChild size="small" className="rounded-full">
                  <a
                    href={`mailto:${org.email}?body=${encodeURIComponent(org.script)}`}
                  >
                    Email {org.email}
                  </a>
                </Button>
              ) : null}
              {org.phone ? (
                <Button
                  asChild
                  size="small"
                  variant="outline"
                  className="rounded-full"
                >
                  <a href={`tel:${org.phone}`}>Call {org.phone}</a>
                </Button>
              ) : null}
              {org.url ? (
                <Button
                  asChild
                  size="small"
                  variant="outline"
                  className="rounded-full"
                >
                  <a href={org.url} target="_blank" rel="noreferrer">
                    Their site
                  </a>
                </Button>
              ) : null}
            </div>
          </SheetBody>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

// The advance affordance the ordinance flow uses: a full-width row rather than
// a button, so it reads as the next thing in the conversation.
function NextStepRow({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      className="h-auto w-full justify-between rounded-lg border-border bg-card px-4 py-3 text-sm text-foreground shadow-sm hover:border-foreground/20 hover:bg-muted/50 hover:text-foreground"
    >
      <span>{label}</span>
      <ChevronRightIcon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
    </Button>
  )
}
