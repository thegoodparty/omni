import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  CIVIC_PANEL_PAGE_HREF,
  type ChatClarifyQuestion,
  type CivicPanelBuildNext,
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
import { SERVE_CITIZENS_PANEL_COPY as PANEL_COPY } from '../../../contacts/citizens-panel/citizensPanelCopy'
import { civicPanelPlanQueryOptions } from '../../../contacts/citizens-panel/civicPanelPlan.query'

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

// The plan's next step, read live from the plan so it never holds state of
// its own: the panel page's Next line, members against the goal, a button
// that opens that step, and the panel page.
export const CivicPanelNextStepCard = () => {
  const orgSlug = useOrganization()?.slug
  const { data, isPending, isError } = useQuery({
    ...civicPanelPlanQueryOptions(orgSlug),
    enabled: Boolean(orgSlug),
  })
  if (isPending) return <CompactCardLoading />
  if (isError || !data) return <CompactCardUnavailable />
  const next = data.plan?.status === 'active' ? data.next : null
  const label = next ? nextStepLabel(next) : null
  const progress = PANEL_COPY.progress(
    data.progress.members.toLocaleString('en-US'),
    data.progress.goal.toLocaleString('en-US'),
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
      <div className="flex flex-wrap items-center gap-3">
        {label && next?.href ? (
          <Button asChild size="small">
            <Link href={next.href}>{label}</Link>
          </Button>
        ) : null}
        <Link
          href={CIVIC_PANEL_PAGE_HREF}
          className="text-sm text-foreground underline underline-offset-2"
        >
          {CIVIC_PANEL_CHAT_COPY.seePlan}
        </Link>
      </div>
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
