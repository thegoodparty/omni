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
  async getActivityForVoter(
    campaignId: number,
    lalVoterId: string,
    take?: number,
    cursor?: string,
  ) {
    const cursorId = cursor !== undefined ? parseInt(cursor, 10) : undefined
    // A cursor that isn't a valid activity id can't match a row. Return an
    // empty page rather than letting NaN reach Prisma's `cursor: { id }`, which
    // would throw a DB validation error (the `after` query param is a free
    // string shared with the poll path, so non-numeric values can arrive here).
    if (cursorId !== undefined && Number.isNaN(cursorId)) {
      return []
    }
    return this.model.findMany({
      where: { campaignId, lalVoterId },
      orderBy: [
        { occurredAt: Prisma.SortOrder.desc },
        { id: Prisma.SortOrder.desc },
      ],
      ...(take !== undefined ? { take } : {}),
      ...(cursorId !== undefined ? { cursor: { id: cursorId }, skip: 1 } : {}),
    })
  }
}
