'use client'

import NextTaskCard from '../campaign-plan/components/campaignStrategy/NextTaskCard'
import ProUpgradeBanner from '../components/campaignManager/ProUpgradeBanner'
import TextingSetupBanner from '../components/campaignManager/TextingSetupBanner'
import { useHomeHeadline } from './homeHeadlines'
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
  // A mission line rather than a welcome; blank until it is picked on the
  // client, so the card's position does not jump.
  const headline = useHomeHeadline()

  return (
    // On desktop the welcome and the card sit in the middle of the space
    // between the layout's title bar (h-14) and the chat dock's bar. The dock
    // reserves 6rem below the page: pb-24 keeps the centering clear of it, and
    // -mb-24 pulls that reserved space under this background so the layout's
    // grey doesn't show through above it.
    <div className="flex min-h-screen flex-col bg-muted lg:-mb-24 lg:min-h-[calc(100dvh-3.5rem)] lg:pb-24">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 pt-6 lg:my-auto lg:py-6">
        <NextTaskCard
          surface="manager"
          heading={headline ?? '\u00a0'}
          subheading="Here’s what to do next"
        />
        <ProUpgradeBanner />
        <TextingSetupBanner tcrCompliance={tcrCompliance} />
      </div>
    </div>
  )
}
