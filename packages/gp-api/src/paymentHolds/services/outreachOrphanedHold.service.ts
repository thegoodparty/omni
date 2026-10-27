import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { OrphanedHoldReason } from '../paymentHolds.constants'

@Injectable()
export class OutreachOrphanedHoldService extends createPrismaBase(
  MODELS.OutreachOrphanedHold,
) {
  // Upsert so a hold recorded twice stays one pending row, and a re-record
  // never clears voidedAt.
  async record(
    paymentIntentId: string,
    outreachId: number,
    reason: OrphanedHoldReason,
  ): Promise<void> {
    await this.model.upsert({
      where: { paymentIntentId },
      create: { paymentIntentId, outreachId, reason },
      update: {},
    })
  }
}
