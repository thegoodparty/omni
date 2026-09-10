'use client'

import { format, parseISO } from 'date-fns'
import { cn } from '@styleguide'
import { SparklesIcon } from '@styleguide/components/ui/icons'
import type { LucideIcon } from 'lucide-react'
import WideChip, { ASSISTANT_INDENT } from './WideChip'
import { cardCategory } from './cardCategory'
import {
  ONBOARDING_CARDS,
  ONBOARDING_CARD_ORDER,
} from './onboardingCardsConfig'
import { useDashboardCards, useOnboardingCards } from '../data/use-dashboard'
import type { OnboardingCardKey } from '../data/contracts'

const formatDue = (iso: string): string | null => {
  try {
    return format(parseISO(iso), 'EEE, MMM d')
  } catch {
    return null
  }
}

export interface TaskCardData {
  key: string
  Icon: LucideIcon
  title: string
  /** The "why this matters" line. */
  why: string
  /** Due / impact line, rendered in primary. */
  impact?: string
  /** Navigates when set; otherwise `onSelect` opens the card's agent opener. */
  href?: string
  onSelect?: () => void
}

interface UseTaskCardsArgs {
  /** Opens the conversation on this card's agent opener. */
  onOpenCard: (key: OnboardingCardKey) => void
}

interface UseTaskCardsResult {
  cards: TaskCardData[]
  isPending: boolean
  isError: boolean
}

/**
 * The week's prioritized work as card data, in the same order and under the
 * same conditions as the card home: the get-started cards first, then the
 * active dashboard cards.
 *
 * Split from the rendering component because the home has to know whether any
 * cards exist before it renders: task cards and quick-reply chips must never
 * share a turn, so the presence of cards is what empties the chip row.
 */
export function useChiefOfStaffTaskCards({
  onOpenCard,
}: UseTaskCardsArgs): UseTaskCardsResult {
  const { data: cards, isPending, isError } = useDashboardCards('active')
  const { data: onboarding } = useOnboardingCards()

  const out: TaskCardData[] = []

  const activeOnboarding = ONBOARDING_CARD_ORDER.filter((key) =>
    onboarding?.some((c) => c.key === key && c.status === 'active'),
  )
  for (const key of activeOnboarding) {
    const config = ONBOARDING_CARDS[key]
    out.push({
      key: `onboarding-${key}`,
      Icon: SparklesIcon,
      title: config.title,
      why: config.summary,
      onSelect: () => onOpenCard(key),
    })
  }

  for (const card of cards ?? []) {
    const { Icon } = cardCategory(card.type)
    const due = formatDue(card.dueDate)
    out.push({
      key: card.id,
      Icon,
      title: card.title,
      why: card.summary,
      impact: due ? `Due ${due}` : undefined,
      href: card.ctaHref,
    })
  }

  return { cards: out, isPending, isError }
}

/**
 * The task-card rail: the week's prioritized work as wide rows hanging under
 * the agent's last message, which is the returning official's main entry point.
 * Carries no avatar or bubble of its own — the cards belong to the message
 * above them, so a second avatar would read as a second turn.
 *
 * The get-started cards open the conversation on their own agent opener (the
 * same display-only copy the card home passes to the drawer); a dashboard card
 * navigates to its own CTA.
 *
 * Skip is deliberately absent. On the card home each card carries a Skip that
 * dismisses it, but the rail is one turn in a conversation rather than a
 * standing list, so per-card dismissal has nowhere sensible to land. Dismissal
 * stays on the card home and the archive until the design says otherwise.
 *
 * There is deliberately no "you're all caught up" state. The card home ends
 * there, which leaves an official on a dead-end page; a chief of staff with
 * nothing queued should still be saying what changed and what to move forward
 * on. Until the digest and the next-step rail exist this renders nothing and
 * the agent's own starter prompts take the turn, which is a worse home but not
 * a dead end.
 */
export default function ChiefOfStaffTaskCards({
  cards,
  isPending,
  isError,
}: UseTaskCardsResult): React.JSX.Element | null {
  if (isPending) {
    return (
      <div className={cn('flex flex-col', ASSISTANT_INDENT)}>
        <p
          className="text-sm text-muted-foreground"
          data-testid="task-list-loading"
        >
          Loading your tasks...
        </p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className={cn('flex flex-col', ASSISTANT_INDENT)}>
        <p className="text-sm text-muted-foreground">
          We could not load your tasks right now.
        </p>
      </div>
    )
  }

  if (cards.length === 0) return null

  return (
    <div className={cn('flex flex-col gap-2.5', ASSISTANT_INDENT)}>
      {cards.map((card) => (
        <WideChip
          key={card.key}
          Icon={card.Icon}
          title={card.title}
          why={card.why}
          impact={card.impact}
          href={card.href}
          onSelect={card.onSelect}
        />
      ))}
    </div>
  )
}
