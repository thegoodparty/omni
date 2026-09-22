import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { Prisma } from '../../generated/prisma'

// The people a drawn boundary enclosed, frozen at the moment it was drawn.
//
// Deliberately Prisma-only and dependency-free. The scan that produces these
// ids needs people-db and the district gate, both of which live on
// ContactsService, and ContactsService already depends on
// VoterFileFilterService — so a service that both of them can inject has to
// know about neither.
@Injectable()
export class VoterFileFilterGeoService extends createPrismaBase(
  MODELS.VoterFileFilterGeoMember,
) {
  // The stored set is GEOGRAPHIC only: everyone the shape enclosed, before
  // any demographic criteria. Those are re-applied on every read and
  // intersected with this, which is what keeps the two halves independent —
  // editing a list's filters cannot invalidate a boundary it did not move.
  async personIdsFor(voterFileFilterId: number): Promise<string[]> {
    const rows = await this.model.findMany({
      where: { voterFileFilterId },
      select: { personId: true },
    })
    return rows.map(({ personId }) => personId)
  }

  // Inside the caller's transaction, so a boundary and its membership can
  // never be half-written: a `geoPoly` with nobody under it reads as "the
  // shape enclosed nobody" and resolves to an empty list, which is exactly
  // what a torn write would look like.
  async replaceMembers(
    tx: Prisma.TransactionClient,
    voterFileFilterId: number,
    personIds: string[],
  ): Promise<void> {
    await tx.voterFileFilterGeoMember.deleteMany({
      where: { voterFileFilterId },
    })
    if (personIds.length === 0) return
    await tx.voterFileFilterGeoMember.createMany({
      data: personIds.map((personId) => ({ voterFileFilterId, personId })),
      skipDuplicates: true,
    })
  }
}
