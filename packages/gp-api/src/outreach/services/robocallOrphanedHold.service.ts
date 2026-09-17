import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { RobocallOrphanedHold } from '../../generated/prisma'

// Which best-effort void site recorded an orphaned authorization hold.
export type OrphanHoldReason =
  | 'window_fit'
  | 'lost_commit'
  | 'zero_billable'
  | 'cancel_before_send'
  | 'send_failed'

// Records + reads the queue of authorization-hold PaymentIntents whose
// best-effort void may not have landed, so the reconcile sweep can confirm and
// re-void them. Recording is best-effort at the call sites (a reserved hold is
// not a charge, so a lost record only defers release to the ~7-day auth expiry)
// and idempotent here (upsert by intent id).
@Injectable()
export class RobocallOrphanedHoldService extends createPrismaBase(
  MODELS.RobocallOrphanedHold,
) {
  async record(
    paymentIntentId: string,
    outreachId: number | null,
    reason: OrphanHoldReason,
  ): Promise<void> {
    // Upsert, not create: the same intent id can be recorded more than once and
    // must collapse to one pending row. Never un-stamp voidedAt on re-record.
    await this.model.upsert({
      where: { paymentIntentId },
      create: { paymentIntentId, outreachId, reason },
      update: {},
    })
  }

  findUnvoided(): Promise<RobocallOrphanedHold[]> {
    return this.findMany({ where: { voidedAt: null } })
  }

  // Stamps a row voided once the sweep has confirmed the hold canceled at Stripe.
  // Guarded on voidedAt still null so a concurrent double-sweep marks once.
  async markVoided(id: number): Promise<void> {
    await this.model.updateMany({
      where: { id, voidedAt: null },
      data: { voidedAt: new Date() },
    })
  }
}
