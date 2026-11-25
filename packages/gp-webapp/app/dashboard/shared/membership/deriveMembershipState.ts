import { PLAN_PRICING } from '@goodparty_org/contracts'
import type {
  CampaignPlanName,
  PinDelivery,
  SmsComplianceWindow,
} from '@goodparty_org/contracts'
import { useCampaign } from '@shared/hooks/useCampaign'
import type { TcrCompliance } from 'helpers/types'
import { isPinIssued } from 'app/dashboard/profile/texting-compliance/shared/useCvPinGate'

export type MembershipTier = 'free' | 'pro' | 'team'

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
  plan?: CampaignPlanName
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
  plan,
  isElectedOffice,
  tcrStatus,
  hasPeerlyIdentity,
  peerlyCvStatus,
  pinDelivery,
  smsCompliance,
}: MembershipInputs): MembershipState => {
  const tier: MembershipTier = isElectedOffice
    ? 'pro'
    : plan === 'team'
      ? 'team'
      : isPro || plan === 'pro'
        ? 'pro'
        : 'free'

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

export interface PlanState {
  plan: CampaignPlanName
  // The plan the campaign holds on its plan columns, the signal gp-api prices
  // a Team purchase on (heldPlan in campaignPlanPurchase.service): a legacy
  // $10/month subscriber reads free here even though `plan` reads pro. Only
  // 'pro' here earns the Team upgrade price.
  heldPlan: CampaignPlanName
  isPaid: boolean
  // The $10/month Stripe subscription: never offered a plan purchase.
  onSubscription: boolean
  planEndsAt: Date | null
  creditCents: number
  // True above the race-size threshold, where Team is the pitched plan. Stays
  // false when the voter count is missing, so pitches fall back to Pro.
  recommendTeam: boolean
}

// The one place new code reads plan state, so a live resolver can replace
// isPro here later. isPro still decides `plan` for a campaign that predates
// the plan columns.
export const usePlan = (): PlanState => {
  const [campaign] = useCampaign()
  // `plan` defaults to free in the database, so a legacy Pro campaign (isPro
  // set, no plan purchase) reads free there; isPro covers it.
  const plan: CampaignPlanName =
    campaign?.plan && campaign.plan !== 'free'
      ? campaign.plan
      : campaign?.isPro
        ? 'pro'
        : 'free'
  const voters = campaign?.raceTargetMetrics?.registeredVoters
  return {
    plan,
    heldPlan: campaign?.planEndedAt ? 'free' : (campaign?.plan ?? 'free'),
    isPaid: plan !== 'free',
    // A cancelled subscription keeps its pricing model but has ended.
    onSubscription:
      campaign?.planPricingModel === 'subscription' &&
      !campaign.planEndedAt &&
      Boolean(campaign.isPro),
    planEndsAt: campaign?.planEndsAt ? new Date(campaign.planEndsAt) : null,
    creditCents: campaign?.outreachCreditCents ?? 0,
    recommendTeam:
      typeof voters === 'number' &&
      voters > PLAN_PRICING.teamRecommendVoterThreshold,
  }
}
