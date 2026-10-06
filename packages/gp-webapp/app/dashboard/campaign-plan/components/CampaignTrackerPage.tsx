'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@styleguide'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import DashboardLayout from '../../shared/DashboardLayout'
import { NAV_LABELS } from '../../shared/navLabels'
import CampaignStrategySection from './campaignStrategy/CampaignStrategySection'

// Every phase of the tracker and the tasks in each, on a page of its own so
// the Campaign Plan can lead with the next step alone.
export default function CampaignTrackerPage(): React.JSX.Element {
  // The sub-header's right slot, handed to the section for its non-prod
  // "Generate tasks" button.
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null)
  return (
    <DashboardLayout
      navHeader={{ icon: 'scroll', label: 'Campaign Tracker' }}
      wrapperClassName="!p-0"
    >
      {/* The styleguide PageHeader's back sub-bar, drawn on its own: PageHeader
          always renders its main bar too, and DashboardLayout's title bar is
          already that bar here. */}
      {/* Matches the bar above it: the mobile top bar is h-16, the desktop
          title bar h-14. */}
      <div className="flex h-16 items-center gap-2 border-b border-border bg-background px-4 lg:h-14">
        <Button variant="ghost" size="small" asChild>
          <Link href="/dashboard/campaign-plan">
            <ArrowLeftIcon />
            {NAV_LABELS.campaignPlan}
          </Link>
        </Button>
        <div ref={setActionSlot} className="ml-auto flex items-center" />
      </div>
      <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-10">
        <CampaignStrategySection generateSlot={actionSlot} />
      </div>
    </DashboardLayout>
  )
}
