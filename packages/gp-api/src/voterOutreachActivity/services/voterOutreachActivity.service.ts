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
  // (campaignId, lalVoterId, occurredAt) index. When `take` is given the page
  // is bounded at the DB; `cursor` (an activity id) pages forward without
  // loading earlier rows. The `id` tiebreak keeps the order total so cursor
  // paging is deterministic when two activities share an occurredAt.
  getActivityForVoter(
    campaignId: number,
    lalVoterId: string,
    take?: number,
    cursor?: string,
  ) {
    return this.model.findMany({
      where: { campaignId, lalVoterId },
      orderBy: [
        { occurredAt: Prisma.SortOrder.desc },
        { id: Prisma.SortOrder.desc },
      ],
      ...(take !== undefined ? { take } : {}),
      ...(cursor ? { cursor: { id: parseInt(cursor, 10) }, skip: 1 } : {}),
    })
  }
}
