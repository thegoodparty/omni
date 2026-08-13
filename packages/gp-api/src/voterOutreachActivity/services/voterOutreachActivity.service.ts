import { Injectable } from '@nestjs/common'
import { OutreachType, Prisma } from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'

// DEPRECATED — replaced by the ContactInteraction* models and services
// (src/contactInteraction/) per the CRM tech design:
// https://app.clickup.com/90132012119/v/dc/2ky4jq2q-20493/2ky4jq2q-98973
// No new write paths may target this service. Segment-derived send-attribution
// writes were retired in feature 5 (ENG-10731); the only writer left is the
// deprecated eCanvasser door-knock attribution (recordActivityIdempotent).
@Injectable()
export class VoterOutreachActivityService extends createPrismaBase(
  MODELS.VoterOutreachActivity,
) {
  recordActivity(data: Prisma.VoterOutreachActivityUncheckedCreateInput) {
    return this.model.create({ data })
  }

  // Idempotent write for source-event-backed write paths (e.g. door knocking).
  // Keyed on the (campaignId, outreachType, sourceId) unique constraint so a
  // re-sync upserts the same row instead of double-writing — the dedupe is
  // enforced at the DB, not after a read, so concurrent retries can't race in a
  // duplicate. `sourceId` is required here (the upstream event id); the update
  // branch refreshes the fields a re-sync can legitimately change.
  recordActivityIdempotent(
    data: Prisma.VoterOutreachActivityUncheckedCreateInput & {
      sourceId: string
    },
  ) {
    const { campaignId, outreachType, sourceId } = data
    return this.model.upsert({
      where: {
        campaignId_outreachType_sourceId: {
          campaignId,
          outreachType,
          sourceId,
        },
      },
      create: data,
      update: {
        lalVoterId: data.lalVoterId,
        occurredAt: data.occurredAt,
        attributionSource: data.attributionSource,
        metadata: data.metadata,
      },
    })
  }

  // Source-event ids already attributed for a campaign + channel, so a re-sync
  // can skip re-matching them. Only rows with a non-null sourceId are relevant.
  async findSourceIds(
    campaignId: number,
    outreachType: OutreachType,
  ): Promise<Set<string>> {
    const rows = await this.model.findMany({
      where: { campaignId, outreachType, sourceId: { not: null } },
      select: { sourceId: true },
    })
    return new Set(rows.map((row) => row.sourceId).filter((id) => id !== null))
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
