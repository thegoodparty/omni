import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { Opponent } from '../schemas/strategicLandscape.schema'

@Injectable()
export class StrategicLandscapePersister extends createPrismaBase(
  MODELS.CampaignStrategy,
) {
  // The two CAP runs complete independently, so each section is persisted on
  // its own when its result lands. delete-then-insert makes a re-run (retry or
  // regeneration) overwrite cleanly rather than accumulate duplicate rows.
  //
  // Each persist opens with a conditional claim on the plan row, compared
  // against the race the RUN was dispatched for (from its params). The claim
  // accepts a row still on that race, or a row that is still unstamped
  // (legacy pre-backfill) — being adopted onto its campaign's race
  // mid-flight doesn't invalidate a result generated for that same race.
  // Only a genuine race change (row stamped with a different race) drops
  // the result. The claim also takes the plan row's lock first, serializing
  // against the reset transaction (which locks the plan row as its first
  // statement too). Stamping inside the same tx as the rows keeps the
  // existing invariant: 'ready' can't observe rows mid-write.
  //
  // raceId null = the run's params carried no race (shouldn't happen, but
  // Json is untyped at runtime) — claim unconditionally, the pre-stamp
  // behavior.
  private claimWhere(campaignStrategyId: number, raceId: string | null) {
    return raceId === null
      ? { id: campaignStrategyId }
      : { id: campaignStrategyId, OR: [{ raceId }, { raceId: null }] }
  }

  async persistOpponents(
    campaignStrategyId: number,
    raceId: string | null,
    opponents: Opponent[],
  ): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const { count } = await tx.campaignStrategy.updateMany({
        where: this.claimWhere(campaignStrategyId, raceId),
        // Set even for an uncontested race (zero opponents is a real result).
        data: { oppositionPersistedAt: new Date() },
      })
      if (count === 0) {
        this.logger.warn(
          { campaignStrategyId, raceId },
          'dropped opposition result — row is no longer on this race',
        )
        return
      }
      await tx.campaignStrategyOpponent.deleteMany({
        where: { campaignStrategyId },
      })
      if (opponents.length > 0) {
        await tx.campaignStrategyOpponent.createMany({
          data: opponents.map((o) => ({
            campaignStrategyId,
            fullName: o.fullName,
            partyAffiliation: o.partyAffiliation,
            incumbent: o.incumbent,
          })),
        })
      }
    })
  }

  async persistOpportunitiesAndChallenges(
    campaignStrategyId: number,
    raceId: string | null,
    opportunities: string[],
    challenges: string[],
  ): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const { count } = await tx.campaignStrategy.updateMany({
        where: this.claimWhere(campaignStrategyId, raceId),
        data: { opportunitiesPersistedAt: new Date() },
      })
      if (count === 0) {
        this.logger.warn(
          { campaignStrategyId, raceId },
          'dropped opportunities/challenges result — row is no longer on this race',
        )
        return
      }
      await tx.campaignStrategyOpportunity.deleteMany({
        where: { campaignStrategyId },
      })
      await tx.campaignStrategyChallenge.deleteMany({
        where: { campaignStrategyId },
      })
      await tx.campaignStrategyOpportunity.createMany({
        data: opportunities.map((content, i) => ({
          campaignStrategyId,
          order: i + 1,
          content,
        })),
      })
      await tx.campaignStrategyChallenge.createMany({
        data: challenges.map((content, i) => ({
          campaignStrategyId,
          order: i + 1,
          content,
        })),
      })
    })
  }
}
