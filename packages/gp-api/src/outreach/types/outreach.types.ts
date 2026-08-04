import { Prisma } from '../../generated/prisma'
import { BasePurchaseMetadata } from '../../payments/purchase.types'

export type OutreachWithVoterFileFilter = Prisma.OutreachGetPayload<{
  include: { voterFileFilter: true }
}>
export interface OutreachPurchaseMetadata extends BasePurchaseMetadata {
  contactCount: number
  pricePerContact?: number
  outreachType: string
  audienceSize: number
  audienceRequest?: string
  script?: string
  message?: string
  date?: string
  // Links the checkout session to the pending_payment draft the post-purchase
  // handler finalizes. Absent on sessions from clients predating draft-first.
  outreachId?: number
  // The Peerly phone-list upload token (PeerlyPhoneList.token). p2p purchases
  // re-derive the billed contactCount from this server-side rather than
  // trusting the client-supplied value.
  phoneListToken?: string
}
