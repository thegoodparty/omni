import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'

@Injectable()
export class VoterOutreachActivityService extends createPrismaBase(
  MODELS.VoterOutreachActivity,
) {
  recordActivity(data: Prisma.VoterOutreachActivityUncheckedCreateInput) {
    return this.model.create({ data })
  }

  // Person-timeline read: newest first, backed by the
  // (campaignId, lalVoterId, occurredAt) index.
  getActivityForVoter(campaignId: number, lalVoterId: string) {
    return this.model.findMany({
      where: { campaignId, lalVoterId },
      orderBy: { occurredAt: Prisma.SortOrder.desc },
    })
  }
}
