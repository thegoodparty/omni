import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'

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

  // Opted-in/out chip on the person record (ENG-10732): the org-scoped max
  // optedOutAt across every text interaction for this person, or null if
  // they've never opted out. Filtered on (organizationSlug, personId), the
  // prefix of the existing @@index([organizationSlug, personId, occurredAt])
  // — per-person cardinality is low enough that a narrower index isn't
  // warranted.
  async latestOptOutAt(
    organizationSlug: string,
    personId: string,
  ): Promise<Date | null> {
    const result = await this.model.aggregate({
      where: { organizationSlug, personId },
      _max: { optedOutAt: true },
    })
    return result._max.optedOutAt
  }
}
