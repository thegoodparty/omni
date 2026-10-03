import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { Prisma } from '../../generated/prisma'

// The people a sampled list drew, frozen when it was saved. Prisma-only for
// the same reason the geo members are: the draw needs people-db and the
// district gate, which live on ContactsService, and ContactsService already
// depends on VoterFileFilterService.
@Injectable()
export class VoterFileFilterSampleService extends createPrismaBase(
  MODELS.VoterFileFilterSampleMember,
) {
  async personIdsFor(voterFileFilterId: number): Promise<string[]> {
    const rows = await this.model.findMany({
      where: { voterFileFilterId },
      select: { personId: true },
    })
    return rows.map(({ personId }) => personId)
  }

  // Everyone the lists behind these outreaches already drew, so a wider
  // sample of the same audience reaches new people. A list that was not
  // sampled contributes nobody: it already went to its whole audience.
  async personIdsForOutreaches(
    organizationSlug: string,
    outreachIds: number[],
  ): Promise<string[]> {
    if (outreachIds.length === 0) return []
    const rows = await this.model.findMany({
      where: {
        voterFileFilter: {
          organizationSlug,
          outreaches: { some: { id: { in: outreachIds } } },
        },
      },
      select: { personId: true },
    })
    return [...new Set(rows.map(({ personId }) => personId))]
  }

  // Inside the create's transaction, so a list never reads as sampled with
  // its members half-written: a sample with no rows resolves to nobody.
  async writeMembers(
    tx: Prisma.TransactionClient,
    voterFileFilterId: number,
    personIds: string[],
  ): Promise<void> {
    if (personIds.length === 0) return
    await tx.voterFileFilterSampleMember.createMany({
      data: personIds.map((personId) => ({ voterFileFilterId, personId })),
      skipDuplicates: true,
    })
  }
}
