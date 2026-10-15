'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import NextTaskCard from '../campaign-plan/components/campaignStrategy/NextTaskCard'
import { useTrackerTasks } from '../campaign-plan/components/campaignStrategy/useTrackerTasks'
import { useNewTrackerTasks } from '../campaign-plan/components/campaignStrategy/useNewTrackerTasks'
import { useCampaign } from '@shared/hooks/useCampaign'
import ProUpgradeBanner from '../components/campaignManager/ProUpgradeBanner'
import TextingSetupBanner from '../components/campaignManager/TextingSetupBanner'
import ProUpgrade3ComplianceCard from '../components/campaignManager/ProUpgrade3ComplianceCard'
import { FIRST_LANDING_PARAM } from './homeHeadlines'
import type { TcrCompliance } from 'helpers/types'

/**
 * The Campaign Manager dashboard home for the campaign-story cohort: the
 * plan's next task under a headline for its kind, then the Pro and
 * texting-setup banners.
 *
 * The persistent footer chat bar and the chat surface are NOT rendered here —
 * they live in the always-present dock (CampaignManagerChatProvider, mounted in
 * DashboardLayout) so the manager is reachable from every page. This home reads
 * the dock's controls from context.
 */
export default function CampaignManagerHome({
  tcrCompliance,
}: {
  tcrCompliance: TcrCompliance | null
}): React.JSX.Element {
  const router = useRouter()
  const pathname = usePathname()
  const [campaign] = useCampaign()
  const { tasks } = useTrackerTasks()
  // Tasks land in the background; Home says what was added and links to it.
  useNewTrackerTasks(tasks, campaign?.id, {
    onSeePlan: () => router.push('/dashboard/campaign-plan'),
  })
  const searchParams = useSearchParams()
  // Read once, so the greeting survives the param being stripped below.
  const [firstLanding] = useState(
    () => searchParams?.get(FIRST_LANDING_PARAM) === '1',
  )
  // A reload or a shared link must not greet them again.
  useEffect(() => {
    if (!firstLanding || !pathname) return
    const params = new URLSearchParams(searchParams?.toString())
    params.delete(FIRST_LANDING_PARAM)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [firstLanding, pathname, router, searchParams])

  return (
    // On desktop the welcome and the card sit in the middle of the space
    // between the layout's title bar (h-14) and the chat dock's bar. The dock
    // reserves 6rem below the page: pb-24 keeps the centering clear of it, and
    // -mb-24 pulls that reserved space under this background so the layout's
    // grey doesn't show through above it.
    <div className="flex min-h-screen flex-col bg-muted lg:-mb-24 lg:min-h-[calc(100dvh-3.5rem)] lg:pb-24">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 pt-6 lg:my-auto lg:py-6">
        <NextTaskCard surface="manager" firstLanding={firstLanding} />
        <ProUpgradeBanner />
        {/* The two never co-render: the banner owns no record and a
            retryable error, the card every state after (PIN entry, in
            review, approved, denied). Without the card a candidate awaiting
            their PIN has nowhere on Home to enter it. */}
        <TextingSetupBanner tcrCompliance={tcrCompliance} />
        <ProUpgrade3ComplianceCard tcrCompliance={tcrCompliance} />
      </div>
    </div>
  )
}
