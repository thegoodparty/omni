import { Injectable } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { Prisma } from '@/generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { WIN_PER_CAMPAIGN_PRICING_FLAG } from 'src/shared/util/winPerCampaignPricingFlag.util'

export type OutreachCreditSettlement = {
  creditUsedCents: number
  cardCents: number
}

@Injectable()
export class OutreachCreditsService extends createPrismaBase(MODELS.Outreach) {
  constructor(private readonly moduleRef: ModuleRef) {
    super()
  }

  // The channels' entry point: credit only applies under per-campaign pricing,
  // read for the campaign owner, so a flag-off campaign keeps its balance
  // untouched and its sends bill the card in full.
  async reserveIfEnabled(
    campaignId: number,
    outreachId: number,
    estimateCents: number,
  ): Promise<number> {
    if (estimateCents <= 0) return 0
    const owner = await this.client.campaign.findUnique({
      where: { id: campaignId },
      select: { userId: true },
    })
    if (!owner) return 0
    // Resolved lazily: FeaturesService sits in an import cycle that a static
    // import here would trip, as in CampaignsService.
    const { FeaturesService } =
      await import('@/features/services/features.service.js')
    const enabled = await this.moduleRef
      .get(FeaturesService, { strict: false })
      .isFeatureEnabled({
        user: owner.userId,
        feature: WIN_PER_CAMPAIGN_PRICING_FLAG,
      })
    if (!enabled) return 0
    return this.client.$transaction((tx) =>
      this.reserve(tx, campaignId, outreachId, estimateCents),
    )
  }

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
      this.close(client, outreachId, actualCostCents),
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
    await this.run(tx, (client) => this.close(client, outreachId, 0, true))
  }

  // Takes the reserve back off a send that has not been held or settled, so a
  // retry reserves afresh. Unlike release it stamps nothing, which is why a
  // later reserve still works. Zeroing the reserve is its own once-only claim.
  async unreserve(
    outreachId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    return this.run(tx, async (client) => {
      const [claim] = await client.$queryRaw<
        { reserved_cents: number; campaign_id: number | null }[]
      >`
        UPDATE outreach o
        SET credit_reserved_cents = 0
        FROM (
          SELECT id, credit_reserved_cents AS previous
          FROM outreach
          WHERE id = ${outreachId}
            AND credit_settled_at IS NULL
            AND credit_reserved_cents > 0
          FOR UPDATE
        ) held
        WHERE o.id = held.id
        RETURNING held.previous AS reserved_cents, o."campaignId" AS campaign_id
      `
      if (!claim) return 0
      await this.giveBack(client, claim.campaign_id, claim.reserved_cents)
      return claim.reserved_cents
    })
  }

  // Gives a settled send's credit back after its card portion was refunded.
  // Its own claim, separate from creditSettledAt, so a refund retried by a
  // webhook or a sweep credits once. A release stamps a used amount of 0, so
  // a send that never billed has nothing to return.
  async refundUsed(
    outreachId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    return this.run(tx, async (client) => {
      const [claim] = await client.$queryRaw<
        { used_cents: number; campaign_id: number | null }[]
      >`
        UPDATE outreach
        SET credit_refunded_at = NOW()
        WHERE id = ${outreachId}
          AND credit_settled_at IS NOT NULL
          AND credit_used_cents > 0
          AND credit_refunded_at IS NULL
        RETURNING credit_used_cents AS used_cents, "campaignId" AS campaign_id
      `
      if (!claim) return 0
      await this.giveBack(client, claim.campaign_id, claim.used_cents)
      return claim.used_cents
    })
  }

  // Credit never resurrects once the plan has ended.
  private async giveBack(
    tx: Prisma.TransactionClient,
    campaignId: number | null,
    cents: number,
  ): Promise<void> {
    if (campaignId === null || cents <= 0) return
    await tx.$executeRaw`
      UPDATE campaign
      SET outreach_credit_cents = outreach_credit_cents + ${cents}
      WHERE id = ${campaignId} AND plan_ended_at IS NULL
    `
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
    actualCostCents: number,
    zeroReserve = false,
  ): Promise<number> {
    const [claim] = await tx.$queryRaw<
      {
        credit_reserved_cents: number
        credit_used_cents: number
        campaign_id: number | null
      }[]
    >`
      UPDATE outreach
      SET credit_settled_at = NOW(),
          credit_used_cents = LEAST(credit_reserved_cents, ${actualCostCents})
      WHERE id = ${outreachId} AND credit_settled_at IS NULL
      RETURNING credit_reserved_cents, credit_used_cents,
        "campaignId" AS campaign_id
    `
    if (!claim) {
      const settled = await tx.outreach.findUniqueOrThrow({
        where: { id: outreachId },
        select: { creditReservedCents: true },
      })
      return settled.creditReservedCents
    }

    const {
      credit_reserved_cents: reservedCents,
      credit_used_cents: usedCents,
      campaign_id: campaignId,
    } = claim
    // A released send holds nothing, so a later settle bills the card in full
    // and a later reserve reports 0, rather than reading a refunded amount.
    if (zeroReserve) {
      await tx.outreach.update({
        where: { id: outreachId },
        data: { creditReservedCents: 0 },
      })
    }
    await this.giveBack(tx, campaignId, reservedCents - usedCents)
    return reservedCents
  }
}
