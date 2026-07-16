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
}
