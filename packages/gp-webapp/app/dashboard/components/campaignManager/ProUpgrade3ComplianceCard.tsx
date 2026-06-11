'use client'

import { useCampaign } from '@shared/hooks/useCampaign'
import { useProUpgrade3Flag } from '@shared/experiments/proUpgrade3Flag'
import ProUpgrade3Compliance from 'app/dashboard/profile/texting-compliance-agentic/components/ProUpgrade3Compliance'

// Per ENG-10335 the pro-upgrade3 post-payment compliance surface (PIN entry,
// then review/approved/denied as the TCR record progresses) also lives on the
// dashboard home, in the slot the ProUpgradeBanner vacates once the candidate
// is Pro. Gate it the way the profile does: Pro-only, pro-upgrade3 cohort, and
// wait for the flag to resolve so the off cohort never flashes the card.
export default function ProUpgrade3ComplianceCard(): React.JSX.Element | null {
  const [campaign] = useCampaign()
  const { ready, enabled } = useProUpgrade3Flag()
  const isPro = campaign?.isPro ?? false

  if (!ready || !enabled || !isPro) {
    return null
  }

  return <ProUpgrade3Compliance />
}
