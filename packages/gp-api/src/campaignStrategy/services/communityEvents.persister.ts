import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { CommunityEventsResult } from '@goodparty_org/contracts'

@Injectable()
export class CommunityEventsPersister extends createPrismaBase(
  MODELS.CampaignStrategy,
) {
  // Single-column update over the `community_events` JSON slot. No
  // transaction needed — one row, one column. last-write-wins on the
  // rare cross-pod race; the next poll's cache read picks up whichever
  // version landed. Guarded on the row still being stamped with the race
  // this result was generated for: an office change resets the row
  // mid-flight, and a stale job's result must be dropped, not land on
  // the new race.
  async persist(
    campaignStrategyId: number,
    raceId: string,
    result: CommunityEventsResult,
  ): Promise<void> {
    const { count } = await this.client.campaignStrategy.updateMany({
      where: { id: campaignStrategyId, raceId },
      data: { communityEvents: result },
    })
    if (count === 0) {
      this.logger.warn(
        { campaignStrategyId, raceId },
        'dropped community-events result — row is no longer on this race',
      )
    }
  }
}
