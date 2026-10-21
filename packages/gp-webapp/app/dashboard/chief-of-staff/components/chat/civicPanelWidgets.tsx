import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  civicPanelOpenStepDetail,
  civicPanelStepTitle,
  type ChatClarifyQuestion,
  type CivicPanelBuildNext,
  type CivicPanelBuildStep,
} from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { useOrganization } from '@shared/organization-picker'
import ClarifyQuestionWidget from '../../../shared/agent-chat/ClarifyQuestionWidget'
import {
  PANEL_WEEKLY_TIME_TOOL,
  type ClarifyWidgetContext,
} from '../../../shared/agent-chat/clarifyWidget'
import { defineWidgetTool } from '../../../shared/agent-chat/widgetRegistry'
import {
  CompactCardLink,
  CompactCardLoading,
  CompactCardStatic,
  CompactCardUnavailable,
} from '../../../shared/agent-chat/cards/cardShell'
import {
  civicPanelHref,
  SERVE_CITIZENS_PANEL_COPY as PANEL_COPY,
} from '../../../contacts/citizens-panel/citizensPanelCopy'
import { civicPanelPlanQueryOptions } from '../../../contacts/citizens-panel/civicPanelSummary.query'
import {
  keepGoingHref,
  useCivicPanelStepFlow,
} from '../../../contacts/citizens-panel/components/useCivicPanelStepFlow'

export const PANEL_NEXT_STEP_TOOL = 'present_panel_next_step'
// Makes or changes the plan, so the next step card and the home's panel
// card are read again once it returns.
export const SAVE_PANEL_WEEKLY_TIME_TOOL = 'save_panel_weekly_time'

export const CIVIC_PANEL_CHAT_COPY = {
  seePlan: 'See your plan',
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

// The plan's next step as the standard outreach card, read live from the
// plan so it never holds state of its own: the step in the panel page's
// words and a button that opens its own text, call or door flow the way the
// panel page does. No member count or panel status: before anyone is
// invited, "too few members" only discourages. With no step to take (waiting
// on replies), a row to the panel page with its Next line.
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
  const textingOff = step?.channel === 'text' && stepFlow.textingOff
  const action = (() => {
    if (!label || !next?.href || !step) return null
    if (keepGoing && step.channel !== 'text') {
      return (
        <Button asChild size="small" className="shrink-0">
          <Link href={keepGoing}>{label}</Link>
        </Button>
      )
    }
    if (step.status !== 'not_started' || textingOff) return null
    return (
      <Button
        type="button"
        size="small"
        className="shrink-0"
        loading={starting}
        onClick={() => void start(step)}
      >
        {label}
      </Button>
    )
  })()

  return (
    <div
      className="flex w-full max-w-md flex-col gap-2"
      data-testid="civic-panel-next-step"
    >
      {step && label ? (
        <CompactCardStatic
          title={civicPanelStepTitle(step)}
          subtitle={
            textingOff ? PANEL_COPY.textingOff : civicPanelOpenStepDetail(step)
          }
          action={
            // With nothing to start here (texting not set up), the panel
            // page is still the way forward.
            action ?? (
              <Button
                asChild
                size="small"
                variant="outline"
                className="shrink-0"
              >
                <Link href={civicPanelHref('chief_of_staff_chat')}>
                  {CIVIC_PANEL_CHAT_COPY.seePlan}
                </Link>
              </Button>
            )
          }
          wrapSubtitle
        />
      ) : (
        <CompactCardLink
          title={CIVIC_PANEL_CHAT_COPY.seePlan}
          subtitle={next?.line}
          href={civicPanelHref('chief_of_staff_chat')}
        />
      )}
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
