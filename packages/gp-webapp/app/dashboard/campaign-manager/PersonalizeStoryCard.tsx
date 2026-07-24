'use client'

import { useEffect, useState } from 'react'
import { useCampaignStoryComplete } from 'app/dashboard/campaign-story/useCampaignStoryComplete'
import ManagerPromptCard from './ManagerPromptCard'

// Persisted skip: the ⋮ "Skip" hides the card until the story is completed (it
// reappears if the candidate reopens it another way). localStorage matches the
// meet card's dismissal pattern.
const PERSONALIZE_DISMISSED_KEY = 'campaign-manager-personalize-dismissed'

interface Props {
  onPersonalize: () => void
}

// The story card on the manager home. Shows only while the Campaign Story is
// incomplete (a candidate who skipped it in onboarding, or has not shared it
// yet) and disappears once complete, whether finished here in the chat or in
// onboarding. Renders nothing while the story state is still loading so it
// never flashes. Enabled unconditionally: this only renders inside the
// campaign-story cohort's manager home.
export default function PersonalizeStoryCard({
  onPersonalize,
}: Props): React.JSX.Element | null {
  const { isComplete, isLoading } = useCampaignStoryComplete(true)
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    try {
      if (window.localStorage.getItem(PERSONALIZE_DISMISSED_KEY) === '1') {
        setDismissed(true)
      }
    } catch {
      // Storage disabled: leave it shown.
    }
  }, [])

  const onSkip = (): void => {
    try {
      window.localStorage.setItem(PERSONALIZE_DISMISSED_KEY, '1')
    } catch {
      // Storage disabled: hide for this session only.
    }
    setDismissed(true)
  }

  if (isLoading || isComplete || dismissed) return null

  return (
    // onPersonalize opens the manager AND auto-launches the story intake chat
    // flow (see CampaignManagerHome's startStory).
    <ManagerPromptCard
      title="Personalize your campaign messaging"
      description="Tell me your reasons for running and I can personalize your voter outreach plan to match."
      ctaLabel="Personalize your campaign"
      onCta={onPersonalize}
      onSkip={onSkip}
    />
  )
}
