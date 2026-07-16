import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'

@Injectable()
export class ContactInteractionRobocallService extends createPrismaBase(
  MODELS.ContactInteractionRobocall,
) {
  create(data: Prisma.ContactInteractionRobocallUncheckedCreateInput) {
    return this.model.create({ data })
  }

  // Batch insert for materializing a segment-level robocall into
  // per-recipient rows (feature 5). Idempotent via the (outreachId, personId)
  // unique constraint: skipDuplicates lets a retry re-emit the whole batch
  // without duplicating recipients already recorded. Returns the count
  // actually inserted.
  createManyIdempotent(
    data: Prisma.ContactInteractionRobocallUncheckedCreateInput[],
  ) {
    return this.model.createMany({ data, skipDuplicates: true })
  }
}
