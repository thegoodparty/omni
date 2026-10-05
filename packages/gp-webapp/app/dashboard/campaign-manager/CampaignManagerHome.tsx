'use client'

import NextTaskCard from '../campaign-plan/components/campaignStrategy/NextTaskCard'
import ProUpgradeBanner from '../components/campaignManager/ProUpgradeBanner'
import TextingSetupBanner from '../components/campaignManager/TextingSetupBanner'
import ProUpgrade3ComplianceCard from '../components/campaignManager/ProUpgrade3ComplianceCard'
import { useUser } from '@shared/hooks/useUser'
import type { TcrCompliance } from 'helpers/types'

/**
 * The Campaign Manager dashboard home for the campaign-story cohort: the Pro
 * banner, the texting-compliance surfaces, the first-run
 * "meet your campaign manager" card, and the top tracker tasks.
 *
 * The two compliance surfaces split the TCR states between them and never
 * co-render: TextingSetupBanner owns the retryable `error` record, and
 * ProUpgrade3ComplianceCard owns everything else — the no-record "get started"
 * card plus every post-start state (PIN entry, in review, approved, denied).
 * Both are required; the card alone would have no retry prompt, and the banner
 * alone would leave a candidate awaiting their PIN with no surface here.
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
    <div className="flex min-h-screen flex-col bg-muted">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 pt-6">
        <NextTaskCard
          surface="manager"
          heading={firstName ? `Welcome back, ${firstName}!` : 'Welcome back!'}
          subheading="Here’s what to do next"
        />
        <h2 className="mt-4 text-lg font-medium text-foreground">
          Latest updates
        </h2>
        <ProUpgradeBanner />
        <TextingSetupBanner tcrCompliance={tcrCompliance} />
        <ProUpgrade3ComplianceCard tcrCompliance={tcrCompliance} />
      </div>
    </div>
  )
}
