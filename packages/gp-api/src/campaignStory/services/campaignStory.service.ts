import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { CampaignStory } from '@goodparty_org/contracts'
import { UpdateCampaignStoryInput } from '../schemas/updateCampaignStory.schema'

@Injectable()
export class CampaignStoryService extends createPrismaBase(
  MODELS.CampaignStory,
) {
  async getForCampaign(campaignId: number): Promise<CampaignStory> {
    const story = await this.model.findUnique({ where: { campaignId } })
    return {
      why: story?.why ?? null,
      background: story?.background ?? null,
      issues: story?.issues ?? null,
    }
  }

  async upsertForCampaign(
    campaignId: number,
    input: UpdateCampaignStoryInput,
  ): Promise<CampaignStory> {
    // Prisma's `upsert` is not transactional in Postgres (SELECT then
    // INSERT-or-UPDATE), so two autosave PUTs landing in the same window
    // before the row exists both attempt INSERT and the loser trips the
    // @@unique(campaign_id) constraint (P2002). The row exists by then, so
    // apply our fields as an UPDATE — re-fetching instead would drop them.
    try {
      const { why, background, issues } = await this.model.upsert({
        where: { campaignId },
        create: { campaignId, ...input },
        update: input,
      })
      return { why, background, issues }
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const { why, background, issues } = await this.model.update({
        where: { campaignId },
        data: input,
      })
      return { why, background, issues }
    }
  }
}
