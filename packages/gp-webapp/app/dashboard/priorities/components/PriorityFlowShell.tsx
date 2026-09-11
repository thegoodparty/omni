'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
import type { Priority } from '@goodparty_org/contracts'
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
import {
  splitSegments,
  type OutreachChannel,
  type OutreachOrg,
  type OutreachPlan,
  type PriorityDirective,
} from '../data/stepProtocol'
import PriorityQuestion from './PriorityQuestion'
import { usePinnedAutoScroll } from '../../shared/agent-chat/usePinnedAutoScroll'
import { useStreamingTurn } from '../../shared/agent-chat/useStreamingTurn'
import { priorityFlowChatApi } from '../data/chat-api'
import { buildStepPrompt } from '../data/stepPrompts'
import {
  PRIORITY_NEXT_STEP_CTA,
  PRIORITY_STEP_CAPTIONS,
  PRIORITY_STEP_LABELS,
  nextPriorityStep,
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

  const { messages, visibleSegments, sending, send, isStreaming } =
    useStreamingTurn(priorityFlowChatApi, {
      toolLabel,
      onTurnStart: () => setStreamError(null),
      onError: (message) => setStreamError(message),
    })

  const askStep = useCallback(
    (target: PriorityFlowStep, id: string): void => {
      const prompt = buildStepPrompt(target, priority, issues)
      setHiddenSent((prev) => [...prev, prompt])
      void send(id, prompt, { hidden: true })
    },
    [priority, issues, send],
  )
  // Held in a ref so the bootstrap effects don't take it as a dependency.
  const askStepRef = useRef(askStep)
  useEffect(() => {
    askStepRef.current = askStep
  }, [askStep])

  // One conversation for the whole flow session. Opened on mount, with no deps:
  // askStep's identity changes with every turn, and having it here opened a
  // fresh conversation per change.
  useEffect(() => {
    if (creatingRef.current) return
    creatingRef.current = true
    void (async () => {
      try {
        const { conversationId: id } =
          await priorityFlowChatApi.createConversation()
        setConversationId(id)
      } catch {
        setStartError(
          "We couldn't start work on this priority. Please try again.",
        )
      }
    })()
  }, [])

  // Kick off the first step once the conversation exists. Separate from the
  // create so a kickoff aborted on unmount (React's dev double-mount does this)
  // fires again on the mount that survives.
  const kickedOffRef = useRef(false)
  useEffect(() => {
    if (!conversationId || kickedOffRef.current) return
    kickedOffRef.current = true
    askStepRef.current('define', conversationId)
  }, [conversationId])

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
  const settled = latestDirective?.kind === 'synthesis'
  // Nothing visible from this turn yet: hold the shimmer rather than an empty
  // gap under the step's question.
  const working = sending && liveSplit.segments.length === 0

  // The agent has already built the list and drafted the message, so this is
  // not permission to do the work: it is the official taking work that is
  // done. It opens the channel's own flow on the message to review.
  const openOutreach = (plan: OutreachPlan): void => {
    const params = new URLSearchParams({
      flow: plan.channel,
      message: plan.message,
    })
    if (plan.listId !== null) params.set('listId', String(plan.listId))
    router.push(`/dashboard/constituent-outreach?${params.toString()}`)
  }

  const answerQuestion = (messageId: string, answer: string): void => {
    if (!conversationId || isStreaming()) return
    setAnswers((prev) => ({ ...prev, [messageId]: answer }))
    void send(conversationId, answer)
  }

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
                  {split.directive?.kind === 'synthesis' ? (
                    <SettledCard
                      text={split.directive.settled}
                      outreach={split.directive.outreach}
                      orgs={split.directive.orgs}
                      onOutreach={openOutreach}
                    />
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
                {working ? <ThinkingRow /> : null}
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

// What the step settled on, the visible half of this flow's save_synthesis,
// with the outreach it recommends off the back of it. The recommendation is
// proposed, not waited for: what was agreed here is the official's read, and
// the step is not really done until it survives contact with the people it
// lands on.
function SettledCard({
  text,
  outreach,
  orgs,
  onOutreach,
}: {
  text: string
  outreach: OutreachPlan | null
  orgs: OutreachOrg[]
  onOutreach: (plan: OutreachPlan) => void
}): React.JSX.Element {
  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          What this step settled
        </span>
        <p className="text-sm text-foreground">{text}</p>
      </div>
      {outreach ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Worth hearing from
          </span>
          <p className="text-sm font-medium text-foreground">
            {outreach.who}
            {outreach.count !== null ? ` (${outreach.count})` : ''}
          </p>
          <p className="text-sm text-muted-foreground">{outreach.why}</p>
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
      ) : null}
      {orgs.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Groups who can reach further than your list
          </span>
          {orgs.map((org) => (
            <div key={org.name} className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">
                {org.name}
              </span>
              <span className="text-sm text-muted-foreground">{org.why}</span>
              <span className="text-sm text-foreground">{org.how}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
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
