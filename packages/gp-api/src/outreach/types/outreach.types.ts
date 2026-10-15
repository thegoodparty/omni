import { Prisma } from '../../generated/prisma'
import { BasePurchaseMetadata } from '../../payments/purchase.types'

export type OutreachWithVoterFileFilter = Prisma.OutreachGetPayload<{
  include: { voterFileFilter: true }
}>
export interface OutreachPurchaseMetadata extends BasePurchaseMetadata {
  contactCount: number
  outreachType: string
  audienceSize: number
  audienceRequest?: string
  script?: string
  message?: string
  date?: string
  // Links the checkout session to the pending_payment draft the post-purchase
  // handler finalizes. Required for p2p: the draft's own phone list is what a
  // p2p purchase is priced from.
  outreachId?: number
  // The PeerlyPhoneList row id of a build still in progress (gated by the
  // win_sms_hold_billing flag), so the biggest lists can pay while they build.
  // Read only for a draft that has no Peerly list yet, and then only when the
  // build belongs to this campaign and to the draft's own saved voter list. A
  // draft that names its list is billed for that list and this is ignored.
  phoneListBuildId?: string
  // Resolved ONCE by PurchaseService at entry (checkout-session creation, or
  // free-purchase confirmation) for the paying user, and reused here rather
  // than re-read — see PurchaseService.resolveWinSmsHoldBillingEnabled.
  // Absent/false is the pre-feature, immediate-charge path.
  winSmsHoldBillingEnabled?: boolean
}
