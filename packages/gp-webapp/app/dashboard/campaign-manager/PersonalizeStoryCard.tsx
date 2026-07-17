'use client'

import { Button } from '@styleguide'
import { useCampaignStoryComplete } from 'app/dashboard/campaign-story/useCampaignStoryComplete'

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
  if (isLoading || isComplete) return null
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">
          Personalize your campaign messaging
        </h2>
        <p className="text-sm text-muted-foreground">
          Tell me your reasons for running and I can personalize your voter
          outreach plan to match.
        </p>
      </div>
      {/* onPersonalize opens the manager AND auto-launches the story intake
          chat flow (see CampaignManagerHome's startStory). */}
      <Button className="self-start" onClick={onPersonalize}>
        Personalize your campaign
      </Button>
    </div>
  )
}
