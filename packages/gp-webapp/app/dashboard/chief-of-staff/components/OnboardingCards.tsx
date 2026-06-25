'use client'

import { SparklesIcon } from '@styleguide/components/ui/icons'
import TaskCard from './TaskCard'
import {
  useOnboardingCards,
  useSkipOnboardingCard,
} from '../data/use-dashboard'
import {
  ONBOARDING_CARDS,
  ONBOARDING_CARD_ORDER,
} from './onboardingCardsConfig'
import type { OnboardingCardKey } from '../data/contracts'

interface Props {
  /** Open the chat with the agent opener tailored to the clicked card. */
  onOpenCard: (key: OnboardingCardKey) => void
}

/**
 * The two get-started cards at the top of the dashboard list. Each is shown
 * only while its server-derived status is `active` — skipping persists (and the
 * card moves to the archive's Skipped list), and the card disappears once its
 * goal is met (you've chatted with the agent / stated a priority). Clicking the
 * CTA opens a fresh chat where the agent prompts you.
 */
export default function OnboardingCards({
  onOpenCard,
}: Props): React.JSX.Element | null {
  const { data: cards } = useOnboardingCards()
  const skip = useSkipOnboardingCard()

  if (!cards) return null
  const active = ONBOARDING_CARD_ORDER.filter((key) =>
    cards.some((c) => c.key === key && c.status === 'active'),
  )
  if (active.length === 0) return null

  return (
    <div className="flex flex-col gap-4">
      {active.map((key) => {
        const config = ONBOARDING_CARDS[key]
        return (
          <TaskCard
            key={key}
            eyebrowLabel={config.eyebrowLabel}
            EyebrowIcon={SparklesIcon}
            title={config.title}
            summary={config.summary}
            ctaLabel={config.ctaLabel}
            onCta={() => onOpenCard(key)}
            onSkip={() => skip.mutate(key)}
            skipDisabled={skip.isPending}
          />
        )
      })}
    </div>
  )
}
