'use client'

import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { cn } from '@styleguide'
import {
  CalendarIcon,
  ClipboardListIcon,
  MapPinIcon,
  SparklesIcon,
  UsersIcon,
} from '@styleguide/components/ui/icons'
import type { LucideIcon } from 'lucide-react'
import type { TcrCompliance } from 'helpers/types'
import { CAMPAIGN_MANAGER_START_STORY_SENTINEL } from '@goodparty_org/contracts'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useCampaignStoryComplete } from 'app/dashboard/campaign-story/useCampaignStoryComplete'
import {
  CAMPAIGN_MANAGER_BALLOT_KICKOFF,
  CAMPAIGN_MANAGER_EVENT_KICKOFF,
  CAMPAIGN_MANAGER_OUTREACH_REVIEW_KICKOFF,
} from './campaignManagerChat'
import TextingSetupBanner from '../components/campaignManager/TextingSetupBanner'
import ProUpgrade3ComplianceCard from '../components/campaignManager/ProUpgrade3ComplianceCard'
import { useTrackerTasks } from '../campaign-plan/components/campaignStrategy/useTrackerTasks'
import { selectTopDynamicTasks } from './selectTopDynamicTasks'
import { taskHref, taskMeta } from './trackerTaskCta'

// Aligns the rail to the assistant column, so the cards hang under the
// preceding message's bubble rather than under its avatar. Tracks the shared
// AssistantRow anatomy (24px avatar + 8px gap); the design specifies 44px off a
// 34px avatar, so this moves with the avatar if that lands.
const ASSISTANT_INDENT = 'pl-8'

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
  /** Sends a kickoff into the conversation, hidden, as a normal turn. */
  onKickoff: (content: string) => void
}

interface UseTaskCardsResult {
  cards: TaskCardData[]
  /** The CAP run has not produced this week's tasks yet. */
  isGenerating: boolean
  /**
   * Every task in the latest generation is done, and the next generation has
   * not landed. Changes the rail's framing from "here is the week" to "you are
   * clear, here is what to do with the room".
   */
  isWeekClear: boolean
  /**
   * Whether the 10DLC compliance surfaces belong in the rail: the candidate is
   * Pro and has cleared the onboarding cards, so compliance is the next real
   * step rather than a third thing competing with getting on the ballot.
   */
  showCompliance: boolean
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
  onKickoff,
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
      onSelect: () => onKickoff(CAMPAIGN_MANAGER_BALLOT_KICKOFF),
    })
  } else if (ballotStatus === 'considering') {
    cards.push({
      key: 'ballot',
      Icon: SparklesIcon,
      title: 'See what it takes to get on the ballot',
      why: 'You told us you are still considering the run. I can lay out the requirements, the deadline, and the real effort involved.',
      onSelect: () => onKickoff(CAMPAIGN_MANAGER_BALLOT_KICKOFF),
    })
  }

  if (!storyLoading && !storyComplete) {
    cards.push({
      key: 'story',
      Icon: SparklesIcon,
      title: 'Tell me why you are running',
      why: 'Your reasons and top issues are what let me write outreach in your voice instead of generic copy.',
      onSelect: () => onKickoff(CAMPAIGN_MANAGER_START_STORY_SENTINEL),
    })
  }

  const onboardingCardCount = cards.length

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

  // Dynamic tasks have been generated at least once, and every one in the
  // latest generation is complete. Regeneration is a weekly server-side CAP
  // run, so this can hold for days and the client has no way to ask for more
  // (POST tracker-tasks/generate takes no channel and is non-prod only).
  // Rather than say nothing, spend the room on the two channels that scale by
  // effort instead of by budget, plus a review of what the outreach so far
  // actually produced.
  const hasDynamicTasks = tasks.some((t) => !t.isDefaultTask)
  const isWeekClear = hasDynamicTasks && top.length === 0

  if (isWeekClear) {
    cards.push({
      key: 'more-doors',
      Icon: MapPinIcon,
      title: 'Knock another turf this week',
      why: 'Doors are the highest-yield thing you can add without spending anything. Pick a turf and I will build the route.',
      href: '/dashboard/door-knocking',
    })
    cards.push({
      key: 'plan-event',
      Icon: CalendarIcon,
      title: 'Put an event on the calendar',
      why: 'One meet-and-greet reaches people no text can. I can suggest a format and a place that fits your district.',
      onSelect: () => onKickoff(CAMPAIGN_MANAGER_EVENT_KICKOFF),
    })
    cards.push({
      key: 'outreach-review',
      Icon: UsersIcon,
      title: 'Go deeper on the voters you reached',
      why: 'Let me look at who you have already contacted, who is still undecided, and which of them is worth a second pass.',
      onSelect: () => onKickoff(CAMPAIGN_MANAGER_OUTREACH_REVIEW_KICKOFF),
    })
  }

  return {
    cards,
    isGenerating: isGeneratingDynamic && top.length === 0,
    isWeekClear,
    // Pro-only by design: a non-Pro candidate gets no Pro surface on this home
    // at all, upsell included, so the conversation never recommends something
    // they cannot act on. Gated on the onboarding cards being clear so
    // compliance arrives as a middle step rather than competing with getting on
    // the ballot.
    showCompliance: (campaign?.isPro ?? false) && onboardingCardCount === 0,
  }
}

function TaskCard({ card }: { card: TaskCardData }): React.JSX.Element {
  const body = (
    <>
      <span className="mt-0.5 shrink-0 text-primary">
        <card.Icon className="size-[18px]" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="text-[14.5px] font-semibold leading-[1.35] text-card-foreground">
          {card.title}
        </span>
        <span className="text-[13px] leading-[1.45] text-muted-foreground">
          {card.why}
        </span>
        {card.impact && (
          <span className="text-xs font-semibold tracking-[.02em] text-primary">
            {card.impact}
          </span>
        )}
      </span>
    </>
  )

  // Flat by default, border to primary on hover, 150ms. Min height keeps the
  // whole row a >=44px tap target on small screens.
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
 * The task-card rail: the week's recommendations as wide rows hanging under the
 * manager's last message, which is the returning candidate's main entry point
 * into the week. Deliberately carries no avatar or bubble of its own — the
 * cards belong to the message above them, so a second avatar would read as a
 * second turn.
 *
 * The two onboarding cards fire hidden chat kickoffs, so the answer arrives in
 * the conversation without the candidate leaving it. A tracker task navigates:
 * an outreach task deep-links into the hub rather than opening the channel flow
 * here, because the hub owns the one instance of each flow plus its Pro and
 * 10DLC gates (outreach/AGENTS.md). Opening those flows in this surface's own
 * sheet, which is what the design calls for, means hoisting them out of the hub
 * first.
 *
 * 10DLC compliance rides along once onboarding is done, for Pro candidates
 * only. These are the card home's own surfaces rather than chip versions of
 * them: the flow has real state (awaiting PIN, in review, approved, denied) and
 * a chip would drop it, which is the whole reason the card home renders both —
 * `TextingSetupBanner` prompts a Pro candidate who never started, and
 * `ProUpgrade3ComplianceCard` carries every post-start state.
 */
export default function CampaignManagerTaskCards({
  cards,
  isGenerating,
  isWeekClear,
  showCompliance,
  tcrCompliance,
}: {
  cards: TaskCardData[]
  isGenerating: boolean
  isWeekClear: boolean
  showCompliance: boolean
  tcrCompliance: TcrCompliance | null
}): React.JSX.Element | null {
  if (cards.length === 0 && !showCompliance && !isGenerating) return null

  return (
    <div className={cn('flex flex-col gap-2.5', ASSISTANT_INDENT)}>
      {isGenerating && (
        <p className="text-sm text-muted-foreground">
          I am still putting this week&apos;s tasks together.
        </p>
      )}

      {isWeekClear && (
        <p className="text-sm text-muted-foreground">
          You are clear on everything I set for this week. Nice work. Next
          week&apos;s tasks are not out yet, so here is where I would spend the
          room.
        </p>
      )}

      {cards.map((card) => (
        <TaskCard key={card.key} card={card} />
      ))}

      {showCompliance && (
        <>
          <TextingSetupBanner tcrCompliance={tcrCompliance} />
          <ProUpgrade3ComplianceCard />
        </>
      )}

      {cards.length > 0 && (
        <TaskCard
          card={{
            key: 'tracker',
            Icon: ClipboardListIcon,
            title: 'See your full campaign plan',
            why: 'Every task, not just this week, plus the strategy behind them.',
            href: '/dashboard/campaign-plan',
          }}
        />
      )}
    </div>
  )
}
