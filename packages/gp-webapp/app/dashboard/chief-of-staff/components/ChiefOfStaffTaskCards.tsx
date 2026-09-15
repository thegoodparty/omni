'use client'

import { cn } from '@styleguide'
import { SparklesIcon } from '@styleguide/components/ui/icons'
import type { LucideIcon } from 'lucide-react'
import WideChip, { ASSISTANT_INDENT } from './WideChip'
import {
  ONBOARDING_CARDS,
  ONBOARDING_CARD_ORDER,
} from './onboardingCardsConfig'
import { useOnboardingCards } from '../data/use-dashboard'
import type { OnboardingCardKey } from '../data/contracts'

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
 * The get-started cards as card data.
 *
 * Briefings, agenda items and community issues used to land here too. They are
 * the notifications inbox's now: they are dated heads-ups with a place to go,
 * they arrive whether or not the official is mid-conversation, and rendering
 * them in both places showed every one of them twice on the same screen. What
 * is left is the setup work, which belongs in the conversation because the
 * conversation is where it gets done.
 *
 * Split from the rendering component because the home has to know whether any
 * cards exist before it renders: task cards and quick-reply chips must never
 * share a turn, so the presence of cards is what empties the chip row.
 */
export function useChiefOfStaffTaskCards({
  onOpenCard,
}: UseTaskCardsArgs): UseTaskCardsResult {
  const { isPending, isError } = useOnboardingCards()
  const { data: onboarding } = useOnboardingCards()

  const out: TaskCardData[] = []

  // `meet` is dropped on this surface. Its whole job is to get an official
  // into the chat, and on this home they are already in it — and its
  // completion test is "has a chief-of-staff conversation", which this home
  // does not create until the first send, so the card would sit in the rail
  // inviting someone to meet the agent they are looking at.
  const activeOnboarding = ONBOARDING_CARD_ORDER.filter(
    (key) =>
      key !== 'meet' &&
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
