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
  // Each persist opens with a conditional claim on the plan row: the
  // persistedAt stamp only lands if the row still holds the race the run was
  // dispatched for (raceId null = legacy unstamped row, matched as IS NULL).
  // A race change between onExperimentRunCompleted's plan lookup and this
  // write resets the row, so the claim matches zero rows and the stale
  // result is dropped without touching the new race's children. The claim
  // also takes the plan row's lock first, serializing against the reset
  // transaction (which locks the plan row as its first statement too).
  // Stamping inside the same tx as the rows keeps the existing invariant:
  // 'ready' can't observe rows mid-write.
  async persistOpponents(
    campaignStrategyId: number,
    raceId: string | null,
    opponents: Opponent[],
  ): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const { count } = await tx.campaignStrategy.updateMany({
        where: { id: campaignStrategyId, raceId },
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
        where: { id: campaignStrategyId, raceId },
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
