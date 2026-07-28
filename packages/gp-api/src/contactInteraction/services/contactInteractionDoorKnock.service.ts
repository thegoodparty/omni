import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'

@Injectable()
export class ContactInteractionDoorKnockService extends createPrismaBase(
  MODELS.ContactInteractionDoorKnock,
) {
  create(data: Prisma.ContactInteractionDoorKnockUncheckedCreateInput) {
    return this.model.create({ data })
  }

  // Idempotent write for the door-knocking tool's sync path. Keyed on the
  // (organizationSlug, sourceId) unique constraint so a re-sync upserts the
  // same row instead of double-writing — the dedupe is enforced at the DB,
  // not after a read, so concurrent retries can't race in a duplicate.
  // `sourceId` is required here; manual logs (null sourceId) use `create`.
  recordIdempotent(
    data: Prisma.ContactInteractionDoorKnockUncheckedCreateInput & {
      sourceId: string
    },
  ) {
    const { organizationSlug, sourceId } = data
    return this.model.upsert({
      where: {
        organizationSlug_sourceId: { organizationSlug, sourceId },
      },
      create: data,
      update: {
        personId: data.personId,
        occurredAt: data.occurredAt,
        outcome: data.outcome,
        supportAnswer: data.supportAnswer,
        willVote: data.willVote,
        note: data.note,
      },
    })
  }
}
