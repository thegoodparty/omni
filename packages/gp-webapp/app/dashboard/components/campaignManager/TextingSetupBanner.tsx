'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button, Card } from '@styleguide'
import { MessageSquareIcon } from '@styleguide/components/ui/icons'
import { useCampaign } from '@shared/hooks/useCampaign'
import { TcrCompliance } from 'helpers/types'
import { TCR_COMPLIANCE_STATUS } from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import ComplianceCardArt from 'app/dashboard/profile/texting-compliance-agentic/components/ComplianceCardArt'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

// Top-of-dashboard prompt for Pro candidates who never started 10DLC texting
// compliance (no TCR record, or a retryable `error` record). Post-start
// statuses have dedicated surfaces in ProUpgrade3Compliance (PIN entry,
// in-review, approved, denied), so a "start" prompt would be wrong there.
// For the no-record/error case this deliberately doubles with that
// component's "Set up texting compliance" fallthrough card (ENG-10858
// product decision: the banner is additive, the card stays). Renders in the
// slot ProUpgradeBanner vacates once the candidate is Pro — the two never
// co-render. The election-filing form it links to also collects the
// candidate's bio and policy issues when those are missing.
export default function TextingSetupBanner({
  tcrCompliance,
}: {
  tcrCompliance: TcrCompliance | null
}): React.JSX.Element | null {
  const [campaign] = useCampaign()
  const isPro = campaign?.isPro ?? false

  const show =
    isPro &&
    (!tcrCompliance || tcrCompliance.status === TCR_COMPLIANCE_STATUS.ERROR)

  useEffect(() => {
    if (show) {
      trackEvent(EVENTS.ProUpgrade.Compliance.TextingSetupBannerViewed)
    }
  }, [show])

  if (!show) {
    return null
  }

  const handleStart = () => {
    trackEvent(EVENTS.ProUpgrade.Compliance.TextingSetupBannerStart)
  }

  return (
    <Card className="relative overflow-hidden p-6">
      <div className="relative z-10 flex flex-col items-start gap-3 pr-24">
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold">Finish your texting setup</p>
          <p className="text-sm text-muted-foreground">
            Your Pro plan includes texting voters. Register your campaign for
            10DLC compliance to start sending texts.
          </p>
        </div>
        <Button asChild onClick={handleStart}>
          <Link href="/dashboard/profile/texting-compliance/election-filing">
            Start registration
          </Link>
        </Button>
      </div>
      <ComplianceCardArt
        swooshColorClassName="bg-info-background"
        icon={<MessageSquareIcon className="h-14 w-14 text-info" aria-hidden />}
      />
    </Card>
  )
}
