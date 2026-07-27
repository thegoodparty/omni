'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCampaignStoryComplete } from 'app/dashboard/campaign-story/useCampaignStoryComplete'
import ManagerPromptCard from './ManagerPromptCard'

// Persisted dismissal: the card is a one-time "your plan is ready" nudge, so
// once the candidate acts on it (or skips it) it stays gone.
const STORY_READY_DISMISSED_KEY = 'campaign-manager-story-ready-dismissed'

// Shown on the manager home once the Campaign Story is complete — whether the
// candidate finished it here in the chat or on the "Your story" page — to point
// them at the generated tracker + plan (this replaces the toast that used to sit
// at the bottom of the "Your story" page). Renders nothing while the story is
// incomplete (the PersonalizeStoryCard covers that state) or still loading, and
// after it's been dismissed. Enabled unconditionally: only renders inside the
// campaign-story cohort's manager home.
export default function StoryReadyCard(): React.JSX.Element | null {
  const router = useRouter()
  const { isComplete, isLoading } = useCampaignStoryComplete(true)
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORY_READY_DISMISSED_KEY) === '1') {
        setDismissed(true)
      }
    } catch {
      // Storage disabled: leave it shown.
    }
  }, [])

  const dismiss = (): void => {
    try {
      window.localStorage.setItem(STORY_READY_DISMISSED_KEY, '1')
    } catch {
      // Storage disabled: hide for this session only.
    }
    setDismissed(true)
  }

  if (isLoading || !isComplete || dismissed) return null

  return (
    <ManagerPromptCard
      title="Your campaign tracker and plan are ready"
      description="Your personalized campaign tracker and outreach plan are ready for you."
      ctaLabel="Review your campaign tracker"
      onCta={() => {
        dismiss()
        router.push('/dashboard/campaign-plan')
      }}
      onSkip={dismiss}
    />
  )
}
