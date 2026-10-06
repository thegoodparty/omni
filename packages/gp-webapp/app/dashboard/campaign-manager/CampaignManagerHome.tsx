'use client'

import NextTaskCard from '../campaign-plan/components/campaignStrategy/NextTaskCard'
import ProUpgradeBanner from '../components/campaignManager/ProUpgradeBanner'
import TextingSetupBanner from '../components/campaignManager/TextingSetupBanner'
import { GoodPartyOrgLogo } from '@styleguide'
import { useUser } from '@shared/hooks/useUser'
import type { TcrCompliance } from 'helpers/types'

/**
 * The Campaign Manager dashboard home for the campaign-story cohort: the Pro
 * banner, the texting-setup banner, the first-run
 * "meet your campaign manager" card, and the top tracker tasks.
 *
 * The persistent footer chat bar and the chat surface are NOT rendered here —
 * they live in the always-present dock (CampaignManagerChatProvider, mounted in
 * DashboardLayout) so the manager is reachable from every page. This home reads
 * the dock's controls from context: the meet card opens the manager (dismissing
 * itself), and the personalize card launches the story-intake flow.
 */
export default function CampaignManagerHome({
  tcrCompliance,
}: {
  tcrCompliance: TcrCompliance | null
}): React.JSX.Element {
  const [user] = useUser()
  const firstName = user?.firstName

  return (
    // On desktop the manager mark sits at the top and the welcome and the card
    // in the middle of the space left. The chat dock reserves 6rem below the
    // page for its bar: pb-24 keeps the centering clear of the bar, and -mb-24
    // pulls that reserved space under this background so the layout's grey
    // doesn't show through above it.
    <div className="flex min-h-screen flex-col bg-muted lg:-mb-24 lg:min-h-dvh lg:pb-24">
      <div className="hidden flex-col items-center gap-2 pt-6 lg:flex">
        <GoodPartyOrgLogo />
        <span className="text-sm font-semibold text-foreground">
          Campaign manager
        </span>
      </div>
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 pt-6 lg:my-auto lg:py-6">
        <NextTaskCard
          surface="manager"
          heading={firstName ? `Welcome back, ${firstName}!` : 'Welcome back!'}
          subheading="Here’s what to do next"
        />
        <ProUpgradeBanner />
        <TextingSetupBanner tcrCompliance={tcrCompliance} />
      </div>
    </div>
  )
}
