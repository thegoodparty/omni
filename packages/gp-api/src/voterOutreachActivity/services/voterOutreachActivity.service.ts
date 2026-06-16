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
    // Validate the cursor before handing it to Prisma's `cursor: { id }`. The
    // `after` query param is a free string shared with the poll path, so it can
    // be non-numeric (NaN) or a stale/foreign id. Either way the cursor matches
    // no row for this voter, so the page is empty — confirm the cursor row
    // exists here rather than relying on Prisma's missing-cursor behavior.
    if (cursorId !== undefined) {
      if (Number.isNaN(cursorId)) {
        return []
      }
      const cursorRow = await this.model.findFirst({
        where: { id: cursorId, campaignId, lalVoterId },
        select: { id: true },
      })
      if (!cursorRow) {
        return []
      }
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
