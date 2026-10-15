import type { PinDelivery, SmsComplianceWindow } from '@goodparty_org/contracts'
import type { TcrCompliance } from 'helpers/types'
import { isPinIssued } from 'app/dashboard/profile/texting-compliance/shared/useCvPinGate'

export type MembershipTier = 'free' | 'pro'

export type TextingState =
  | 'needs_verification'
  | 'in_review'
  | 'awaiting_pin'
  | 'cleared'
  | 'closed'

export interface MembershipState {
  tier: MembershipTier
  texting: TextingState
  pinDelivery: PinDelivery | null
  isElectedOffice: boolean
}

export interface MembershipInputs {
  isPro: boolean
  isElectedOffice: boolean
  tcrStatus: TcrCompliance['status'] | null
  hasPeerlyIdentity: boolean
  peerlyCvStatus: string | null
  pinDelivery: PinDelivery | null
  smsCompliance: SmsComplianceWindow
}

// Mirrors the server's compliance stages without a second read of them: the
// TCR status plus the Peerly identity discriminator (the same one
// deriveComplianceStage and useCvPinGate use) is enough to name the next step
// the candidate must take. PIN state is never inferred from the local status
// alone (ENG-10866).
export const deriveMembershipState = ({
  isPro,
  isElectedOffice,
  tcrStatus,
  hasPeerlyIdentity,
  peerlyCvStatus,
  pinDelivery,
  smsCompliance,
}: MembershipInputs): MembershipState => {
  const tier: MembershipTier = isPro || isElectedOffice ? 'pro' : 'free'

  // gp-api reports 'closed' only for a campaign whose verification never
  // started (no kickoff), so it wins over whatever the TCR record says: a
  // record without a kickoff cannot clear before the election.
  let texting: TextingState = 'needs_verification'
  if (smsCompliance === 'closed') {
    texting = 'closed'
  } else if (tcrStatus === 'approved') {
    texting = 'cleared'
  } else if (tcrStatus === 'pending') {
    texting = 'in_review'
  } else if (tcrStatus === 'submitted') {
    texting =
      hasPeerlyIdentity && isPinIssued(peerlyCvStatus)
        ? 'awaiting_pin'
        : 'in_review'
  }

  return {
    tier,
    texting,
    pinDelivery: texting === 'awaiting_pin' ? pinDelivery : null,
    isElectedOffice,
  }
}
