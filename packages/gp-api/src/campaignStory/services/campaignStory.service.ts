import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
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
    const { why, background, issues } = await this.model.upsert({
      where: { campaignId },
      create: { campaignId, ...input },
      update: input,
    })
    return { why, background, issues }
  }
}
