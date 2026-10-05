import { useMemo, type ReactNode } from 'react'
import { differenceInCalendarDays, format, startOfDay } from 'date-fns'
import { Badge, Button, Card } from '@styleguide'
import {
  CalendarClockIcon,
  ListChecksIcon,
  SparklesIcon,
  TrendingUpIcon,
} from '@styleguide/components/ui/icons'
import { useCampaign } from '@shared/hooks/useCampaign'
import { buildTrackerStrategy } from '../campaign-plan/components/campaignStrategy/buildTrackerStrategy'
import { useTrackerTasks } from '../campaign-plan/components/campaignStrategy/useTrackerTasks'
import type { CampaignStrategyPhaseKey } from '../campaign-plan/components/campaignStrategy/campaignStrategy.types'
import { useCampaignManagerChat } from './CampaignManagerChatProvider'

const PHASE_TIPS: Record<CampaignStrategyPhaseKey, string> = {
  preLaunch:
    'Start with people who already know you. Friends and colleagues become your first donors and volunteers.',
  launch:
    'Say the same three things everywhere. Voters need to hear your message several times before it sticks.',
  active:
    'Spend your time on voters who could go either way. Your supporters only need a reminder later.',
  gotv: 'Make voting easy for your supporters. Remind them when, where and how to vote.',
}

// Date-only and full-ISO tracker dates both read as local midnight.
const localDate = (iso: string): Date =>
  new Date(iso.slice(0, 10).replace(/-/g, '/'))

const daysAway = (days: number): string =>
  days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`

interface InsightCardProps {
  icon: ReactNode
  label: string
  title: string
  body: string
  badge?: string
  question: string
  onAsk?: (question: string) => void
}

const InsightCard = ({
  icon,
  label,
  title,
  body,
  badge,
  question,
  onAsk,
}: InsightCardProps): React.JSX.Element => (
  <Card className="gap-2 rounded-2xl border-components-input-border p-4">
    <div className="flex items-center gap-2 text-muted-foreground">
      {icon}
      <span className="text-xs font-semibold uppercase tracking-wide">
        {label}
      </span>
      {badge && (
        <Badge variant="soft" className="ml-auto">
          {badge}
        </Badge>
      )}
    </div>
    <p className="text-sm font-semibold text-card-foreground">{title}</p>
    <p className="text-sm text-muted-foreground">{body}</p>
    {onAsk && (
      <Button
        type="button"
        variant="link"
        size="small"
        className="mt-auto h-auto self-start px-0"
        onClick={() => onAsk(question)}
      >
        Ask about this
      </Button>
    )}
  </Card>
)

export default function CampaignManagerInsights(): React.JSX.Element | null {
  const [campaign] = useCampaign()
  const { tasks } = useTrackerTasks()
  const chat = useCampaignManagerChat()

  // Same precedence NextTaskCard uses, so both read the same election.
  const metrics = campaign?.raceTargetMetrics
  const electionDateIso =
    metrics?.relevantElectionDate ??
    metrics?.generalElectionDate ??
    campaign?.details?.electionDate ??
    campaign?.electionDate ??
    null

  const insights = useMemo(() => {
    if (tasks.length === 0) return null
    const electionDate = electionDateIso ? localDate(electionDateIso) : null
    const { phases } = buildTrackerStrategy(tasks, { electionDate })
    const activeIndex = phases.findIndex((p) => p.status === 'active')
    const active = phases[activeIndex]
    if (!active) return null

    const phaseTasks = tasks.filter((t) => t.phase === active.key)
    const done = phaseTasks.filter((t) => t.completed).length
    const dynamic = tasks.filter((t) => !t.isDefaultTask)
    const latestGen = Math.max(-Infinity, ...dynamic.map((t) => t.week))
    const tailored = dynamic.filter((t) => t.week === latestGen).length

    const today = startOfDay(new Date())
    const nextPhase = phases
      .slice(activeIndex + 1)
      .map((phase) => {
        const dates = tasks
          .filter((t) => t.phase === phase.key && t.date)
          .map((t) => localDate(t.date).getTime())
        return dates.length > 0
          ? { title: phase.title, start: new Date(Math.min(...dates)) }
          : null
      })
      .find((p) => p !== null && p.start >= today)
    const heads =
      nextPhase && nextPhase.start
        ? {
            title: `${nextPhase.title} starts ${daysAway(
              differenceInCalendarDays(nextPhase.start, today),
            )}`,
            body: `On ${format(nextPhase.start, 'MMM d')}. A good moment to check your plan is on track.`,
          }
        : electionDate && electionDate >= today
          ? {
              title: `Election Day is ${daysAway(
                differenceInCalendarDays(electionDate, today),
              )}`,
              body: `On ${format(electionDate, 'MMM d')}. Make sure your supporters know when and where to vote.`,
            }
          : null

    return {
      phaseTitle: active.title,
      tip: PHASE_TIPS[active.key],
      recap: {
        title: `${done} of ${phaseTasks.length} ${active.title.toLowerCase()} tasks done`,
        body:
          tailored > 0
            ? `${tailored} of your tasks are tailored to your story and refreshed each week.`
            : 'Your plan refreshes each week as your campaign moves forward.',
      },
      heads,
    }
  }, [tasks, electionDateIso])

  if (!insights) return null

  const ask = chat?.discussTask

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <InsightCard
        icon={<ListChecksIcon className="size-4" aria-hidden />}
        label="Your week"
        title={insights.recap.title}
        body={insights.recap.body}
        question="How is my campaign going so far, and what should I focus on next?"
        onAsk={ask}
      />
      <InsightCard
        icon={<SparklesIcon className="size-4" aria-hidden />}
        label="Tip"
        title={`For ${insights.phaseTitle.toLowerCase()}`}
        body={insights.tip}
        question={`Give me more advice for the ${insights.phaseTitle.toLowerCase()} stage of my campaign.`}
        onAsk={ask}
      />
      {insights.heads && (
        <InsightCard
          icon={<CalendarClockIcon className="size-4" aria-hidden />}
          label="Coming up"
          title={insights.heads.title}
          body={insights.heads.body}
          question="What should I get ready for before the next stage of my campaign?"
          onAsk={ask}
        />
      )}
      {/* Prototype sample: no candidate-side source for district topics yet. */}
      <InsightCard
        icon={<TrendingUpIcon className="size-4" aria-hidden />}
        label="Local pulse"
        badge="Sample"
        title="Road repairs are a hot topic in your district"
        body="Residents keep raising potholes and delayed repairs. A clear plan here could set you apart."
        question="What are voters in my district talking about right now, and how should I respond?"
        onAsk={ask}
      />
    </div>
  )
}
