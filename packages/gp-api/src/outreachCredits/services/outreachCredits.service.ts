import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'

export type OutreachCreditSettlement = {
  creditUsedCents: number
  cardCents: number
}

@Injectable()
export class OutreachCreditsService extends createPrismaBase(MODELS.Outreach) {
  // Runs inside the caller's transaction so the reserve commits or rolls back
  // with the send it pays for. The row lock is what serializes two sends on
  // one campaign; the conditional UPDATE is the guard that keeps the balance
  // from going negative if that ever stops holding.
  async reserve(
    tx: Prisma.TransactionClient,
    campaignId: number,
    outreachId: number,
    estimateCents: number,
  ): Promise<number> {
    const [campaign] = await tx.$queryRaw<
      { outreach_credit_cents: number; plan_ended_at: Date | null }[]
    >`SELECT outreach_credit_cents, plan_ended_at FROM campaign WHERE id = ${campaignId} FOR UPDATE`
    const outreach = await tx.outreach.findUniqueOrThrow({
      where: { id: outreachId },
      select: { creditReservedCents: true, creditSettledAt: true },
    })

    if (outreach.creditReservedCents > 0 || outreach.creditSettledAt) {
      return outreach.creditReservedCents
    }
    if (!campaign || campaign.plan_ended_at) {
      return 0
    }

    const reservedCents = Math.min(
      campaign.outreach_credit_cents,
      estimateCents,
    )
    if (reservedCents <= 0) {
      return 0
    }

    const decremented = await tx.$executeRaw`
      UPDATE campaign
      SET outreach_credit_cents = outreach_credit_cents - ${reservedCents}
      WHERE id = ${campaignId} AND outreach_credit_cents >= ${reservedCents}
    `
    if (decremented === 0) {
      return 0
    }

    await tx.outreach.update({
      where: { id: outreachId },
      data: { creditReservedCents: reservedCents },
    })
    return reservedCents
  }

  async settle(
    outreachId: number,
    actualCostCents: number,
    tx?: Prisma.TransactionClient,
  ): Promise<OutreachCreditSettlement> {
    const reservedCents = await this.run(tx, (client) =>
      this.close(client, outreachId, (reserved) =>
        Math.max(0, reserved - actualCostCents),
      ),
    )
    const creditUsedCents = Math.min(reservedCents, actualCostCents)
    return {
      creditUsedCents,
      cardCents: actualCostCents - creditUsedCents,
    }
  }

  async release(
    outreachId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.run(tx, (client) =>
      this.close(client, outreachId, (reserved) => reserved),
    )
  }

  private run<T>(
    tx: Prisma.TransactionClient | undefined,
    fn: (client: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return tx ? fn(tx) : this.client.$transaction(fn)
  }

  // The settled stamp is the once-only claim: a repeat call finds no unsettled
  // row, returns the persisted reserve, and moves no money. Returned credit is
  // dropped when the plan has ended, so a late settle cannot resurrect it.
  private async close(
    tx: Prisma.TransactionClient,
    outreachId: number,
    returnedCents: (reservedCents: number) => number,
  ): Promise<number> {
    const [claim] = await tx.$queryRaw<
      { credit_reserved_cents: number; campaign_id: number | null }[]
    >`
      UPDATE outreach
      SET credit_settled_at = NOW()
      WHERE id = ${outreachId} AND credit_settled_at IS NULL
      RETURNING credit_reserved_cents, "campaignId" AS campaign_id
    `
    if (!claim) {
      const settled = await tx.outreach.findUniqueOrThrow({
        where: { id: outreachId },
        select: { creditReservedCents: true },
      })
      return settled.creditReservedCents
    }

    const { credit_reserved_cents: reservedCents, campaign_id: campaignId } =
      claim
    const returned = returnedCents(reservedCents)
    if (campaignId !== null && returned > 0) {
      await tx.$executeRaw`
        UPDATE campaign
        SET outreach_credit_cents = outreach_credit_cents + ${returned}
        WHERE id = ${campaignId} AND plan_ended_at IS NULL
      `
    }
    return reservedCents
  }
}
