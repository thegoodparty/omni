'use client'

import { useState } from 'react'
import { SparklesIcon } from '@styleguide/components/ui/icons'
import TaskCard from './TaskCard'

interface Props {
  /** Opens the chat surface (the onboarding CTAs are chat entry points). */
  onOpenChat: () => void
  /**
   * When true, show the "Personalize" card. The office has no stated
   * priorities yet, so the CoS onboarding asks for them. Defaults to true
   * until priorities data is wired at integration.
   */
  showPersonalize?: boolean
}

/**
 * The two onboarding cards at the top of the dashboard list. Each is locally
 * dismissible (Skip) and opens the chat (Meet / Personalize). These are UI
 * onboarding prompts, not `DashboardCard` rows, so Skip is local state.
 */
export default function OnboardingCards({
  onOpenChat,
  showPersonalize = true,
}: Props): React.JSX.Element | null {
  const [metSkipped, setMetSkipped] = useState(false)
  const [personalizeSkipped, setPersonalizeSkipped] = useState(false)

  const showMeet = !metSkipped
  const showPersonalizeCard = showPersonalize && !personalizeSkipped

  if (!showMeet && !showPersonalizeCard) return null

  return (
    <div className="flex flex-col gap-4">
      {showMeet && (
        <TaskCard
          highlighted
          scrollSpy
          eyebrowLabel="Get started"
          EyebrowIcon={SparklesIcon}
          title="Meet your virtual chief of staff"
          summary="See how your Chief of Staff can help you prepare for meetings, track priorities, and stay on top of your district."
          ctaLabel="Meet my Chief of Staff"
          onCta={onOpenChat}
          onSkip={() => setMetSkipped(true)}
        />
      )}
      {showPersonalizeCard && (
        <TaskCard
          scrollSpy
          eyebrowLabel="Get started"
          EyebrowIcon={SparklesIcon}
          title="Tell us more about the most important issues you're facing"
          summary="Share the priorities that matter most so your Chief of Staff can tailor its help to your district."
          ctaLabel="Personalize my Chief of Staff"
          onCta={onOpenChat}
          onSkip={() => setPersonalizeSkipped(true)}
        />
      )}
    </div>
  )
}
