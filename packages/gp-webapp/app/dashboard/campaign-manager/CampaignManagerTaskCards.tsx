'use client'

import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { cn } from '@styleguide'
import {
  ChevronRightIcon,
  ClipboardListIcon,
  SparklesIcon,
} from '@styleguide/components/ui/icons'
import type { LucideIcon } from 'lucide-react'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useCampaignStoryComplete } from 'app/dashboard/campaign-story/useCampaignStoryComplete'
import { ASSISTANT_BUBBLE, AssistantRow } from '../shared/agent-chat/chatUI'
import { useTrackerTasks } from '../campaign-plan/components/campaignStrategy/useTrackerTasks'
import { selectTopDynamicTasks } from './selectTopDynamicTasks'
import { taskHref, taskMeta } from './trackerTaskCta'

// Tracker dates arrive as UTC-midnight ISO; slice to the date portion so the
// local render does not land on the previous day in US timezones.
const formatDue = (iso: string): string =>
  format(parseISO(iso.slice(0, 10)), 'EEE, MMM d')

// A task action can point off-app (a state SOS page, a form), which has to open
// in a new tab via a plain anchor; internal routes go through the router.
const isExternalHref = (href: string): boolean =>
  /^(https?:)?\/\//.test(href) ||
  href.startsWith('mailto:') ||
  href.startsWith('tel:')

export interface TaskCardData {
  key: string
  Icon: LucideIcon
  title: string
  /** The "why this matters" line. */
  why: string
  /** Due / impact line, rendered in primary. */
  impact?: string
  /** Navigates when set; otherwise `onSelect` fires a kickoff in-conversation. */
  href?: string
  onSelect?: () => void
}

interface UseTaskCardsArgs {
  onGetOnBallot: () => void
  onPersonalize: () => void
}

interface UseTaskCardsResult {
  cards: TaskCardData[]
  /** The CAP run has not produced this week's tasks yet. */
  isGenerating: boolean
}

/**
 * The week's recommendations, in the same order and under the same gating
 * conditions as the card home's `CampaignManagerTasks`: getting on the ballot
 * outranks personalizing, which outranks the generated tracker tasks.
 *
 * Split from the rendering component because the home has to know whether any
 * cards exist before it renders: task cards and quick-reply chips must never
 * share a turn, so the presence of cards is what empties the chip row.
 */
export function useCampaignManagerTaskCards({
  onGetOnBallot,
  onPersonalize,
}: UseTaskCardsArgs): UseTaskCardsResult {
  const [campaign] = useCampaign()
  const { isComplete: storyComplete, isLoading: storyLoading } =
    useCampaignStoryComplete(true)
  const { tasks, isGeneratingDynamic } = useTrackerTasks()
  const top = selectTopDynamicTasks(tasks)

  const cards: TaskCardData[] = []

  const ballotStatus = campaign?.ballotStatus
  if (ballotStatus === 'qualified-not-filed') {
    cards.push({
      key: 'ballot',
      Icon: SparklesIcon,
      title: "Let's get you on the ballot",
      why: 'You meet the requirements but have not filed yet. Filing is the one thing that has to happen before any of the rest counts.',
      href: undefined,
      onSelect: onGetOnBallot,
    })
  } else if (ballotStatus === 'considering') {
    cards.push({
      key: 'ballot',
      Icon: SparklesIcon,
      title: 'See what it takes to get on the ballot',
      why: 'You told us you are still considering the run. I can lay out the requirements, the deadline, and the real effort involved.',
      onSelect: onGetOnBallot,
    })
  }

  if (!storyLoading && !storyComplete) {
    cards.push({
      key: 'story',
      Icon: SparklesIcon,
      title: 'Tell me why you are running',
      why: 'Your reasons and top issues are what let me write outreach in your voice instead of generic copy.',
      onSelect: onPersonalize,
    })
  }

  for (const task of top) {
    const { Icon } = taskMeta(task.flowType)
    cards.push({
      key: task.id,
      Icon,
      title: task.title,
      why: task.description,
      impact: `Due ${formatDue(task.date)}`,
      href: taskHref(task),
    })
  }

  return { cards, isGenerating: isGeneratingDynamic && top.length === 0 }
}

function TaskCard({ card }: { card: TaskCardData }): React.JSX.Element {
  const body = (
    <>
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <card.Icon className="size-4 text-primary" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold text-card-foreground">
          {card.title}
        </span>
        <span className="text-sm text-muted-foreground">{card.why}</span>
        {card.impact && (
          <span className="mt-0.5 text-xs font-semibold text-primary">
            {card.impact}
          </span>
        )}
      </span>
      <ChevronRightIcon
        className="mt-1.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
    </>
  )

  // Flat by default, border to primary on hover, 150ms. Min height keeps the
  // whole row a ≥44px tap target on small screens.
  const className = cn(
    'flex w-full min-h-11 items-start gap-3 rounded-xl border border-border',
    'bg-card p-3 text-left transition-colors duration-150',
    'hover:border-primary focus-visible:border-primary',
  )

  if (card.href) {
    return isExternalHref(card.href) ? (
      <a
        className={className}
        href={card.href}
        target="_blank"
        rel="noreferrer"
      >
        {body}
      </a>
    ) : (
      <Link className={className} href={card.href}>
        {body}
      </Link>
    )
  }

  return (
    <button type="button" className={className} onClick={card.onSelect}>
      {body}
    </button>
  )
}

/**
 * The task-card rail: one assistant turn whose recommendations each end in a
 * card CTA, which is the returning candidate's main entry point into the week.
 *
 * The two onboarding cards fire hidden chat kickoffs, so the answer arrives in
 * the conversation without the candidate leaving it. A tracker task navigates:
 * an outreach task deep-links into the hub rather than opening the channel flow
 * here, because the hub owns the one instance of each flow plus its Pro and
 * 10DLC gates (outreach/AGENTS.md). Opening those flows in this surface's own
 * sheet, which is what the design calls for, means hoisting them out of the hub
 * first.
 */
export default function CampaignManagerTaskCards({
  cards,
  isGenerating,
}: {
  cards: TaskCardData[]
  isGenerating: boolean
}): React.JSX.Element | null {
  if (cards.length === 0) return null

  return (
    <AssistantRow>
      <div className={ASSISTANT_BUBBLE}>
        {isGenerating
          ? "I'm still putting this week's tasks together. Here's what I'd start on in the meantime."
          : "Here's where I'd put your time this week."}
      </div>
      <div className="flex w-full flex-col gap-2">
        {cards.map((card) => (
          <TaskCard key={card.key} card={card} />
        ))}
        <TaskCard
          card={{
            key: 'tracker',
            Icon: ClipboardListIcon,
            title: 'See your full campaign plan',
            why: 'Every task, not just this week, plus the strategy behind them.',
            href: '/dashboard/campaign-plan',
          }}
        />
      </div>
    </AssistantRow>
  )
}
