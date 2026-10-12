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
  // The PeerlyPhoneList row id, used INSTEAD of phoneListToken when an async
  // build (gated by WIN_SMS_HOLD_BILLING) has no token yet — so the biggest
  // lists can pay while they build. Client-supplied, so every resolution scopes
  // it to the server-validated campaign before it bills, caps, or links (the
  // token is globally @unique; this id is not). Ignored when a token is present.
  phoneListBuildId?: string
}
