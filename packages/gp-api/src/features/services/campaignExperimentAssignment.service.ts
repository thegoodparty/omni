import { Injectable } from '@nestjs/common'
import { Campaign } from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { UsersService } from '@/users/services/users.service'
import { FeaturesService } from './features.service'

type GetOrAssignParams = {
  campaign: Pick<Campaign, 'id' | 'userId'>
  flagKey: string
  arms: readonly string[]
}

@Injectable()
export class CampaignExperimentAssignmentService extends createPrismaBase(
  MODELS.CampaignExperimentAssignment,
) {
  constructor(
    private readonly features: FeaturesService,
    private readonly users: UsersService,
  ) {
    super()
  }

  // The arm is resolved on the campaign owner, not the requesting user, so
  // everyone on a team campaign gets the same arm. Returns null, storing
  // nothing, when Amplitude has no valid variant for the owner (not targeted,
  // or unreachable): the campaign stays enrollable on a later request.
  async getOrAssign({
    campaign,
    flagKey,
    arms,
  }: GetOrAssignParams): Promise<string | null> {
    const existing = await this.model.findUnique({
      where: { campaignId_flagKey: { campaignId: campaign.id, flagKey } },
    })
    if (existing) return existing.arm

    const owner = await this.users.findUniqueOrThrow({
      where: { id: campaign.userId },
    })
    const arm = (await this.features.getAllVariants(owner))[flagKey]?.value
    if (!arm || !arms.includes(arm)) return null

    // First writer wins: two concurrent first requests must not disagree, so a
    // row that already exists is returned unchanged.
    const stored = await this.model.upsert({
      where: { campaignId_flagKey: { campaignId: campaign.id, flagKey } },
      create: {
        campaignId: campaign.id,
        flagKey,
        arm,
        ownerUserId: campaign.userId,
      },
      update: {},
    })
    return stored.arm
  }

  async findArm(campaignId: number, flagKey: string): Promise<string | null> {
    const existing = await this.model.findUnique({
      where: { campaignId_flagKey: { campaignId, flagKey } },
    })
    return existing?.arm ?? null
  }

  // For an experiment whose arm gp-api decides itself rather than taking it
  // from an Amplitude variant. First writer wins, as in getOrAssign, and the
  // stored arm is returned.
  async recordArm({
    campaign,
    flagKey,
    arm,
  }: {
    campaign: Pick<Campaign, 'id' | 'userId'>
    flagKey: string
    arm: string
  }): Promise<string> {
    const stored = await this.model.upsert({
      where: { campaignId_flagKey: { campaignId: campaign.id, flagKey } },
      create: {
        campaignId: campaign.id,
        flagKey,
        arm,
        ownerUserId: campaign.userId,
      },
      update: {},
    })
    return stored.arm
  }
}
