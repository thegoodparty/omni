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
  // handler finalizes, and — for p2p — the only audience input that is
  // trusted: everything billed is read off that row. Absent on sessions from
  // clients predating draft-first.
  outreachId?: number
}
