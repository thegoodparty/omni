'use client'

import { useCampaign } from '@shared/hooks/useCampaign'
import ProUpgrade3Compliance from 'app/dashboard/profile/texting-compliance-agentic/components/ProUpgrade3Compliance'
import { TCR_COMPLIANCE_STATUS } from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import type { TcrCompliance } from 'helpers/types'

// Per ENG-10335 the post-payment compliance surface (PIN entry, then
// review/approved/denied as the TCR record progresses) also lives on the
// dashboard home, in the slot the ProUpgradeBanner vacates once the candidate
// is Pro. Gate it the way the profile does: Pro-only.
//
// The `error` status is the one case this page does NOT render: a failed
// registration is TextingSetupBanner's retry prompt here, and rendering the
// generic "Set up texting compliance" fallthrough underneath it is what put
// two conflicting prompts on the home. Suppression is scoped to this
// dashboard wrapper — the account page mounts ProUpgrade3Compliance directly
// and still shows the fallthrough for `error`, since no banner accompanies it
// there. Both this and the banner read the same server-provided record, so
// they cannot disagree about which one owns the slot.
export default function ProUpgrade3ComplianceCard({
  tcrCompliance,
}: {
  tcrCompliance: TcrCompliance | null
}): React.JSX.Element | null {
  const [campaign] = useCampaign()
  const isPro = campaign?.isPro ?? false

  if (!isPro || tcrCompliance?.status === TCR_COMPLIANCE_STATUS.ERROR) {
    return null
  }

  return <ProUpgrade3Compliance />
}
