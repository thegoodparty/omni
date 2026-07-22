'use client'

import { useState } from 'react'
import Link from 'next/link'
import DashboardLayout from '../../shared/DashboardLayout'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import Paper from '@shared/utils/Paper'
import H2 from '@shared/typography/H2'
import { BookOpenIcon, Button } from '@styleguide'
import { CAMPAIGN_STORY_FLAG_KEY } from '@shared/experiments/campaignStoryFlag'
import OnboardingCampaignStoryStep from 'app/onboarding/components/OnboardingCampaignStoryStep'

interface CampaignStoryPageProps {
  pathname?: string
}

// The standalone "Your story" dashboard page. It reuses the same progressive-
// reveal story form as onboarding (OnboardingCampaignStoryStep — client-fetches
// the bio/background/issues, reveals each question once the prior is saved),
// wrapped in the dashboard chrome plus a footer that points at the tracker once
// the story is complete.
const CampaignStoryPage = ({
  pathname,
}: CampaignStoryPageProps): React.JSX.Element => {
  const [complete, setComplete] = useState(false)

  return (
    <FeatureFlagGuard flagKey={CAMPAIGN_STORY_FLAG_KEY}>
      <DashboardLayout
        pathname={pathname}
        wrapperClassName="w-full"
        showAlert={false}
      >
        <Paper className="mx-auto flex w-full max-w-3xl flex-col gap-8">
          <header className="flex items-center gap-2">
            <BookOpenIcon className="size-6" />
            <H2>Your story</H2>
          </header>

          <p className="text-base text-muted-foreground">
            This is what personalizes your Campaign Plan, Campaign Tracker, and
            your GoodParty.org experience.
          </p>

          <OnboardingCampaignStoryStep onCompleteChange={setComplete} />

          {complete && (
            <div className="sticky bottom-4 z-10 flex flex-col items-stretch gap-3 rounded-xl border border-border bg-white p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm font-medium text-foreground">
                Your Campaign Story is ready.
              </span>
              <Button asChild className="sm:shrink-0">
                <Link href="/dashboard/campaign-plan">
                  Go to your Campaign Tracker
                </Link>
              </Button>
            </div>
          )}
        </Paper>
      </DashboardLayout>
    </FeatureFlagGuard>
  )
}

export default CampaignStoryPage
