'use client'

import type { SmsComplianceWindow } from '@goodparty_org/contracts'
import { useCampaign } from '@shared/hooks/useCampaign'

interface SmsComplianceState {
  smsCompliance: SmsComplianceWindow
  smsCutoffDate: string | null
  generalElectionDate: string | null
}

// gp-api owns the cutoff rule. A campaign response without the field reads as
// 'open', so a surface never closes texting on missing data.
export const useSmsCompliance = (): SmsComplianceState => {
  const [campaign] = useCampaign()
  return {
    smsCompliance: campaign?.smsCompliance ?? 'open',
    smsCutoffDate: campaign?.smsCutoffDate ?? null,
    generalElectionDate: campaign?.generalElectionDate ?? null,
  }
}
