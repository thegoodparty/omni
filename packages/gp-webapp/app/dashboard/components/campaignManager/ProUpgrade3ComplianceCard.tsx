'use client'

import { useCampaign } from '@shared/hooks/useCampaign'
import ProUpgrade3Compliance from 'app/dashboard/profile/texting-compliance-agentic/components/ProUpgrade3Compliance'

// Per ENG-10335 the post-payment compliance surface (PIN entry, then
// review/approved/denied as the TCR record progresses) also lives on the
// dashboard home, in the slot the ProUpgradeBanner vacates once the candidate
// is Pro. Gate it the way the profile does: Pro-only.
export default function ProUpgrade3ComplianceCard(): React.JSX.Element | null {
  const [campaign] = useCampaign()
  const isPro = campaign?.isPro ?? false

  if (!isPro) {
    return null
  }

  return <ProUpgrade3Compliance />
}
