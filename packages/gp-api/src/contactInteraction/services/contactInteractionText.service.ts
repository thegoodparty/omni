import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'

export type InboundTextEventType = 'reply' | 'optout'

export type InboundTextEventOutcome = 'applied' | 'alreadyApplied' | 'noRow'

@Injectable()
export class ContactInteractionTextService extends createPrismaBase(
  MODELS.ContactInteractionText,
) {
  create(data: Prisma.ContactInteractionTextUncheckedCreateInput) {
    return this.model.create({ data })
  }

  // Batch insert for materializing a segment-level text send into
  // per-recipient rows (feature 5). Idempotent via the (outreachId, personId)
  // unique constraint: skipDuplicates lets a retry re-emit the whole batch
  // without duplicating recipients already recorded. Returns the count
  // actually inserted.
  createManyIdempotent(
    data: Prisma.ContactInteractionTextUncheckedCreateInput[],
  ) {
    return this.model.createMany({ data, skipDuplicates: true })
  }

  async findExistingSourceEventIds(
    organizationSlug: string,
    sourceEventIds: string[],
  ): Promise<Set<string>> {
    if (sourceEventIds.length === 0) return new Set()
    const rows = await this.findMany({
      where: { organizationSlug, sourceEventId: { in: sourceEventIds } },
      select: { sourceEventId: true },
    })
    return new Set(rows.flatMap((row) => row.sourceEventId ?? []))
  }

  // Write-back for one Peerly inbound event (feature 5 sweep). Idempotency
  // lives in the UPDATE's WHERE clause, never in a prior read: a reply only
  // fills a null respondedAt (first reply wins) and an opt-out only fills a
  // null optedOutAt, so re-applying an event is a DB-level no-op. Never
  // creates rows — an event with no materialized row reports `noRow` so the
  // caller can log it. `personIds` is plural because one phone can map to
  // several captured recipients; every matching row takes the timestamp,
  // while the sourceEventId lands on a single row to respect the
  // (organizationSlug, sourceEventId) unique index.
  async applyInboundEvent(params: {
    outreachId: number
    personIds: string[]
    eventType: InboundTextEventType
    sourceEventId: string
    observedAt: Date
  }): Promise<InboundTextEventOutcome> {
    const { outreachId, personIds, eventType, sourceEventId, observedAt } =
      params
    const timestampGuard =
      eventType === 'reply' ? { respondedAt: null } : { optedOutAt: null }
    const timestampWrite =
      eventType === 'reply'
        ? { respondedAt: observedAt }
        : { optedOutAt: observedAt }

    const updated = await this.model.updateMany({
      where: {
        outreachId,
        personId: { in: personIds },
        ...timestampGuard,
      },
      data: timestampWrite,
    })
    if (updated.count === 0) {
      const rowCount = await this.count({
        where: { outreachId, personId: { in: personIds } },
      })
      return rowCount === 0 ? 'noRow' : 'alreadyApplied'
    }

    // A row has a single sourceEventId slot; when a reply and an opt-out
    // both land on the same row, the second event can't stamp and is
    // re-screened by the timestamp guards on later sweeps instead.
    const stampTarget = await this.findFirst({
      where: { outreachId, personId: { in: personIds }, sourceEventId: null },
      select: { id: true },
      // Deterministic pick: concurrent sweep replicas processing the same
      // event must claim the same row, not race onto different ones.
      orderBy: { id: Prisma.SortOrder.asc },
    })
    if (stampTarget) {
      try {
        await this.model.updateMany({
          where: { id: stampTarget.id, sourceEventId: null },
          data: { sourceEventId },
        })
      } catch (error) {
        // gp-api runs multiple replicas and every one fires the sweep cron:
        // a sibling can stamp this sourceEventId onto another row between
        // our read and this write. The event's timestamps are already
        // applied, so losing the stamp race is benign — anything else
        // propagates.
        if (!isUniqueConstraintError(error)) throw error
      }
    }
    return 'applied'
  }
}
