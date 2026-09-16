import { Injectable, NotFoundException } from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { Prisma } from '../generated/prisma'
import { PersonMergeFilterDto } from './person-merges.schema'

// How far to follow a chain of merges before giving up. Mirrors
// PersonsService: the ETL publishes terminal survivors, so this only bounds
// the damage from an uncompressed chain or a cycle.
const MAX_MERGE_HOPS = 4

@Injectable()
export class PersonMergesService extends createPrismaBase(MODELS.PersonMerge) {
  // The retirement feed gp-api drains on a cursor: which canonical person ids
  // have been purged as duplicates, and who absorbed each one.
  //
  // Ordered by the full keyset (retiredAt, retiredId) so a consumer can resume
  // exactly where it stopped even when a whole ETL batch shares one timestamp
  // — see the cursor note in person-merges.schema.ts.
  async getPersonMerges(filterDto: PersonMergeFilterDto) {
    const { since, sinceId, limit } = filterDto

    return this.model.findMany({
      where: this.cursorFilter(since, sinceId),
      orderBy: [{ retiredAt: Prisma.SortOrder.asc }, { retiredId: 'asc' }],
      take: limit,
    })
  }

  // Resolves one possibly-retired id to the person that absorbed it.
  //
  // This is the explicit counterpart to by-slug's silent resolution: an id
  // lookup never swaps one person for another behind a caller's back
  // (see PersonsService.getPersonById), so a caller holding an id that may
  // have been purged asks here and decides what to do about it.
  //
  // 404 means "not retired", which is the same answer for an id that never
  // existed. That conflation is deliberate — this table only knows about
  // purged duplicates, and answering "this id is live" would require a Person
  // read that the caller can already do.
  async getPersonMerge(retiredId: string) {
    const merge = await this.model.findUnique({ where: { retiredId } })
    if (!merge) {
      throw new NotFoundException(`No merge found for retiredId=${retiredId}`)
    }

    // The stored survivor is normally already terminal; resolve anyway so a
    // consumer repointing its own rows can never be handed an id that was
    // itself purged in a later run.
    const survivingId = await this.resolveTerminalSurvivor(merge.survivingId)
    return { ...merge, survivingId }
  }

  private cursorFilter(
    since?: string,
    sinceId?: string,
  ): Prisma.PersonMergeWhereInput {
    if (!since) return {}

    const retiredAt = new Date(since)
    // First poll at this timestamp: take the whole boundary inclusively.
    if (!sinceId) return { retiredAt: { gte: retiredAt } }

    // Resume strictly after (since, sinceId) in sort order. Expressed as the
    // two-branch form because Prisma has no row-value comparison.
    return {
      OR: [
        { retiredAt: { gt: retiredAt } },
        { retiredAt, retiredId: { gt: sinceId } },
      ],
    }
  }

  private async resolveTerminalSurvivor(survivingId: string): Promise<string> {
    let current = survivingId
    const seen = new Set([current])

    for (let hop = 0; hop < MAX_MERGE_HOPS; hop++) {
      const next = await this.model.findUnique({
        where: { retiredId: current },
        select: { survivingId: true },
      })
      if (!next || seen.has(next.survivingId)) return current
      seen.add(next.survivingId)
      current = next.survivingId
    }
    return current
  }
}
