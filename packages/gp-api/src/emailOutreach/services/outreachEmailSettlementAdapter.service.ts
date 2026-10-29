import { Injectable } from '@nestjs/common'
import { SettlementAdapter } from '@/paymentHolds/paymentHolds.types'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { OutreachEmailRecipientStatus } from '../../generated/prisma'
import { emailChargeCents } from '../util/emailPricing.util'

// Email's side of the hold module's settle. Setting stoppingAt stops the
// sweep from claiming more (the claim re-checks it under a share lock), and
// the send is ready once no batch is still in flight. After that sentCount
// can't change, so every later call reports the same amount, which the
// per-intent capture key requires.
@Injectable()
export class OutreachEmailSettlementAdapter
  extends createPrismaBase(MODELS.OutreachEmail)
  implements SettlementAdapter
{
  async stopAndReport(
    outreachId: number,
  ): Promise<{ ready: true; amountCents: number } | { ready: false }> {
    const row = await this.model.findUniqueOrThrow({
      where: { outreachId },
      select: { id: true },
    })
    await this.model.updateMany({
      where: { id: row.id, stoppingAt: null },
      data: { stoppingAt: new Date() },
    })
    const inFlight = await this.client.outreachEmailRecipient.count({
      where: {
        outreachEmailId: row.id,
        status: OutreachEmailRecipientStatus.sending,
      },
    })
    if (inFlight > 0) return { ready: false }
    const { sentCount } = await this.model.findUniqueOrThrow({
      where: { id: row.id },
      select: { sentCount: true },
    })
    return { ready: true, amountCents: emailChargeCents(sentCount) }
  }
}
