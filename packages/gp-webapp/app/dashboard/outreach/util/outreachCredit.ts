import { useQuery } from '@tanstack/react-query'
import { fetchOutreachDetail } from 'app/dashboard/outreach/v2/useOutreachDetail'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useWinPerCampaignPricingFlag } from '@shared/experiments/winPerCampaignPricingFlag'
import { usePlan } from 'app/dashboard/shared/membership/deriveMembershipState'
import { formatOutreachCost } from './outreachPricing'

// gp-api's Stripe minimum: a remainder under it is forgiven rather than
// charged, so a send that credit all but covers is not a card payment.
const MIN_CHARGE_CENTS = 50

export interface CreditLines {
  creditCents: number
  totalCents: number
  // What stays on the balance once the send has used its share.
  leftCents: number
}

export const creditLines = (
  costCents: number,
  balanceCents: number,
): CreditLines => {
  const creditCents = Math.min(Math.max(balanceCents, 0), costCents)
  const remainder = costCents - creditCents
  return {
    creditCents,
    totalCents: remainder < MIN_CHARGE_CENTS ? 0 : remainder,
    leftCents: balanceCents - creditCents,
  }
}

export interface OutreachCredit {
  // Credit lines show only with the pricing flag on, and never for a campaign
  // still on the free-texts offer, which gp-api bills on its old path, or for
  // a monthly subscriber, who has no credit and pays the card as before.
  active: boolean
  balanceCents: number
}

export const useOutreachCredit = (): OutreachCredit => {
  const [campaign] = useCampaign()
  const { enabled } = useWinPerCampaignPricingFlag(false)
  const { creditCents, onSubscription } = usePlan()
  return {
    active: enabled && !campaign?.hasFreeTextsOffer && !onSubscription,
    balanceCents: creditCents,
  }
}

export const creditLeftNote = (leftCents: number): string =>
  `${formatOutreachCost(leftCents)} outreach credit left after it sends.`

// The one credit row on a review card: what is left once the send has used
// its share, shown even when that is $0.00.
export const creditRowLabel = (leftCents: number): string =>
  `Outreach credit (${formatOutreachCost(leftCents)} left after)`

// Read off the outreach row rather than the checkout, because every channel
// stamps the same column when it reserves. Its own key and no stale time: the
// shared detail cache may hold the row from before the reserve.
export const useCreditUsedCents = (
  outreachId: number | null,
  enabled: boolean,
): number => {
  const { data } = useQuery({
    queryKey: ['outreach-credit-used', outreachId],
    queryFn: () => fetchOutreachDetail(outreachId as number),
    enabled: enabled && outreachId !== null,
    retry: false,
  })
  return data?.creditReservedCents ?? 0
}
