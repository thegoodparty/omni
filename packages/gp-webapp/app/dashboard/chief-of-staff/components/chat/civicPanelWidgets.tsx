import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type ChatClarifyQuestion,
  type CivicPanelBuildNext,
  type CivicPanelBuildStep,
} from '@goodparty_org/contracts'
import { Button, cn } from '@styleguide'
import { useOrganization } from '@shared/organization-picker'
import ClarifyQuestionWidget from '../../../shared/agent-chat/ClarifyQuestionWidget'
import {
  PANEL_WEEKLY_TIME_TOOL,
  type ClarifyWidgetContext,
} from '../../../shared/agent-chat/clarifyWidget'
import { defineWidgetTool } from '../../../shared/agent-chat/widgetRegistry'
import {
  CompactCardLoading,
  CompactCardUnavailable,
} from '../../../shared/agent-chat/cards/cardShell'
import { OPTION_CARD_CLASS } from '../../../shared/agent-chat/optionCard'
import {
  civicPanelHref,
  SERVE_CITIZENS_PANEL_COPY as PANEL_COPY,
} from '../../../contacts/citizens-panel/citizensPanelCopy'
import { civicPanelPlanQueryOptions } from '../../../contacts/citizens-panel/civicPanelSummary.query'
import { CivicPanelBalanceStatus } from '../../../contacts/citizens-panel/components/CivicPanelBalance'
import {
  keepGoingHref,
  useCivicPanelStepFlow,
} from '../../../contacts/citizens-panel/components/useCivicPanelStepFlow'

export const PANEL_NEXT_STEP_TOOL = 'present_panel_next_step'
// Makes or changes the plan, so the next step card and the home's panel
// card are read again once it returns.
export const SAVE_PANEL_WEEKLY_TIME_TOOL = 'save_panel_weekly_time'

// The progress line is the home's panel card summary, word for word
// (gp-api civicPanelBuildCardContent), so the chat and the home agree.
export const CIVIC_PANEL_CHAT_COPY = {
  seePlan: 'See your plan',
  answers: (expected: number, needed: number) =>
    expected >= needed
      ? `Your panel can give the ${needed.toLocaleString('en-US')} answers you need.`
      : `Your panel can give about ${expected.toLocaleString('en-US')} of the ${needed.toLocaleString('en-US')} answers you need.`,
} as const

// The panel page's own question and answers, so the chat and the page ask
// the same thing. A typed answer goes through the question's own "Or write
// your own...".
export const PANEL_WEEKLY_TIME_QUESTION: ChatClarifyQuestion = {
  questionId: 'civic_panel_weekly_time',
  question: PANEL_COPY.weeklyQuestion,
  options: [
    ...[1, 2, 3].map((hours) => ({ label: PANEL_COPY.hoursPerWeek(hours) })),
    { label: PANEL_COPY.moreHoursPerWeek },
  ],
  multiSelect: false,
}

// Both tools take no args, so the call itself is the widget. A refused call
// persists null args and renders nothing.
const isCall = (args: unknown): boolean =>
  args !== null && typeof args === 'object'

// The panel page's button words for the step the plan has next.
export const nextStepLabel = (next: CivicPanelBuildNext): string | null => {
  if (!next.href || !next.channel) return null
  if (next.status === 'not_started') return PANEL_COPY.startStep[next.channel]
  return next.channel === 'text' ? null : PANEL_COPY.keepGoing[next.channel]
}

// The plan's next step, read live from the plan so it never holds state of
// its own: the panel page's Next line, members against the goal, a button
// that opens that step's own text, call or door flow the way the panel page
// does, and the panel page.
export const CivicPanelNextStepCard = () => {
  const orgSlug = useOrganization()?.slug
  const queryClient = useQueryClient()
  const { data, isPending, isError } = useQuery({
    ...civicPanelPlanQueryOptions(orgSlug),
    enabled: Boolean(orgSlug),
  })
  const [starting, setStarting] = useState(false)
  const [failed, setFailed] = useState(false)
  const stepFlow = useCivicPanelStepFlow({
    surface: 'chief_of_staff_chat',
    onChange: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: civicPanelPlanQueryOptions(orgSlug).queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: ['chief-of-staff', 'cards'],
        }),
      ])
    },
  })
  if (isPending) return <CompactCardLoading />
  if (isError || !data) return <CompactCardUnavailable />
  const next = data.plan?.status === 'active' ? data.next : null
  const label = next ? nextStepLabel(next) : null
  const step =
    data.plan?.steps.find((candidate) => candidate.id === next?.stepId) ?? null

  const start = async (target: CivicPanelBuildStep) => {
    setStarting(true)
    setFailed(false)
    try {
      // Leaving for the door knocking page keeps the button loading.
      if ((await stepFlow.open(target)) === 'navigating') return
    } catch {
      setFailed(true)
    }
    setStarting(false)
  }

  const keepGoing = step ? keepGoingHref(step) : null
  const action = (() => {
    if (!label || !next?.href || !step) return null
    if (keepGoing && step.channel !== 'text') {
      return (
        <Button asChild size="small">
          <Link href={keepGoing}>{label}</Link>
        </Button>
      )
    }
    if (step.status !== 'not_started') return null
    if (step.channel === 'text' && stepFlow.textingOff) {
      return (
        <p className="text-sm text-muted-foreground">{PANEL_COPY.textingOff}</p>
      )
    }
    return (
      <Button
        type="button"
        size="small"
        loading={starting}
        onClick={() => void start(step)}
      >
        {label}
      </Button>
    )
  })()

  const progress = CIVIC_PANEL_CHAT_COPY.answers(
    data.progress.expectedAnswers,
    data.progress.answersNeeded,
  )
  return (
    <div
      className={cn(OPTION_CARD_CLASS, 'flex w-full max-w-md flex-col gap-3')}
      data-testid="civic-panel-next-step"
    >
      <div className="flex flex-col">
        <span className="text-sm font-medium text-foreground">
          {next?.line ?? progress}
        </span>
        {next ? (
          <span className="text-sm leading-6 text-muted-foreground">
            {progress}
          </span>
        ) : null}
      </div>
      {data.balance ? <CivicPanelBalanceStatus balance={data.balance} /> : null}
      <div className="flex flex-wrap items-center gap-3">
        {action}
        <Link
          href={civicPanelHref('chief_of_staff_chat')}
          className="text-sm text-foreground underline underline-offset-2"
        >
          {CIVIC_PANEL_CHAT_COPY.seePlan}
        </Link>
      </div>
      {failed ? (
        <p className="text-sm text-destructive" role="alert">
          {PANEL_COPY.stepError}
        </p>
      ) : null}
      {stepFlow.flows}
    </div>
  )
}

export const civicPanelWidgetTools = [
  defineWidgetTool({
    toolName: PANEL_WEEKLY_TIME_TOOL,
    parse: (args) => (isCall(args) ? PANEL_WEEKLY_TIME_QUESTION : null),
    render: (
      question,
      {
        clarifyInteractive,
        clarifyAnswer,
        onClarifyAnswer,
      }: ClarifyWidgetContext,
    ) => (
      <ClarifyQuestionWidget
        question={question}
        disabled={!clarifyInteractive}
        answer={clarifyAnswer}
        onAnswer={onClarifyAnswer}
        showWrittenAnswer={false}
      />
    ),
  }),
  defineWidgetTool({
    toolName: PANEL_NEXT_STEP_TOOL,
    parse: (args) => (isCall(args) ? {} : null),
    render: () => <CivicPanelNextStepCard />,
  }),
]
