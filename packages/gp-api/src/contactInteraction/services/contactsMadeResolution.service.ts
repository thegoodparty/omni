import { BadRequestException, Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import type { IdOverrides } from '@goodparty_org/contracts'
import {
  type IdFilterResolution,
  MAX_RESOLVED_ID_SET_SIZE,
} from './activityConditionResolution.service'

// 5 means "5+" (>= 5 logged interactions). Mirrors
// CONTACTS_MADE_BUCKET_FIELDS in voterFileFilter.utils.ts.
export type ContactsMadeBucket = 0 | 1 | 2 | 3 | 4 | 5
type NonZeroContactsMadeBucket = Exclude<ContactsMadeBucket, 0>

const NON_ZERO_BUCKETS: readonly NonZeroContactsMadeBucket[] = [1, 2, 3, 4, 5]

// A contacts-made selection either collapses onto the shared `id`
// in/notIn operator (buckets excluding 0, or {0} alone) or needs the
// OR-of-id-sets override composition (0 combined with a non-zero bucket) —
// see resolveContactsMade's doc comment for the full decision table.
export type ContactsMadeResolution =
  | IdFilterResolution
  | { kind: 'override'; idOverrides: IdOverrides }

// ENG-10839/ENG-10944: "a contact" is every logged interaction ROW across
// the four contact_interaction_* tables, regardless of outcome — a
// 3-attempt door-knock sync that logs 3 rows counts as 3, not 1. One
// grouped query over a UNION ALL of all four tables' person_id column,
// bucketed by HAVING — never per-bucket queries (a person's count is
// query-time, computed once here and reused for every requested bucket).
@Injectable()
export class ContactsMadeResolutionService extends createPrismaBase(
  MODELS.ContactInteractionText,
) {
  // buckets: the non-zero buckets to match (5 = >= 5). Returns the set of
  // person ids whose total interaction-row count across all four channels
  // falls in ANY of the requested buckets (buckets OR together).
  async personIdsByContactCount(
    organizationSlug: string,
    buckets: readonly NonZeroContactsMadeBucket[],
  ): Promise<Set<string>> {
    if (buckets.length === 0) return new Set()

    const havingClauses = buckets.map((bucket) =>
      bucket === 5
        ? Prisma.sql`COUNT(*) >= 5`
        : Prisma.sql`COUNT(*) = ${bucket}`,
    )
    const rows = await this.client.$queryRaw<{ personId: string }[]>(Prisma.sql`
      SELECT person_id AS "personId"
      FROM (
        SELECT person_id FROM contact_interaction_text
        WHERE organization_slug = ${organizationSlug}
        UNION ALL
        SELECT person_id FROM contact_interaction_robocall
        WHERE organization_slug = ${organizationSlug}
        UNION ALL
        SELECT person_id FROM contact_interaction_door_knock
        WHERE organization_slug = ${organizationSlug}
        UNION ALL
        SELECT person_id FROM contact_interaction_phone_banking
        WHERE organization_slug = ${organizationSlug}
      ) all_interactions
      GROUP BY person_id
      HAVING ${Prisma.join(havingClauses, ' OR ')}
    `)
    return new Set(rows.map((row) => row.personId))
  }

  // Decision table (selection S subseteq {0,1,2,3,4,5}):
  //  - S excludes 0            -> in = union of the selected buckets' ids
  //    (the existing buildIdFilter path, AND-ed with everything else).
  //  - S = {0}                 -> notIn = everyone ever contacted (any
  //    bucket 1-5+). Enumerating "everyone NOT contacted" directly isn't
  //    tractable (could be the whole district); notIn expresses it without
  //    enumeration.
  //  - S = {0, ...non-zero}    -> the OR-of-id-sets override: contacted
  //    people are excluded UNLESS they're in one of the selected non-zero
  //    buckets. This can't collapse to a single in/notIn operator (bucket
  //    ids are a subset of contacted ids), so it reuses the people-api
  //    idOverrides composition with an absent base clause (people-api
  //    ENG-10839: buildVoterFiltersSql's contactsMadeIdOverrides step).
  async resolveContactsMade(
    organizationSlug: string,
    selected: Set<ContactsMadeBucket>,
  ): Promise<ContactsMadeResolution> {
    if (selected.size === 0) return { kind: 'none' }

    const nonZeroBuckets = NON_ZERO_BUCKETS.filter((bucket) =>
      selected.has(bucket),
    )
    const includesZero = selected.has(0)

    if (!includesZero) {
      const ids = await this.personIdsByContactCount(
        organizationSlug,
        nonZeroBuckets,
      )
      return this.finalizeInSet(organizationSlug, ids)
    }

    if (nonZeroBuckets.length === 0) {
      const contactedIds = await this.personIdsByContactCount(
        organizationSlug,
        NON_ZERO_BUCKETS,
      )
      return this.finalizeNotInSet(organizationSlug, contactedIds)
    }

    const [contactedIds, bucketIds] = await Promise.all([
      this.personIdsByContactCount(organizationSlug, NON_ZERO_BUCKETS),
      this.personIdsByContactCount(organizationSlug, nonZeroBuckets),
    ])
    this.assertUnderCap(organizationSlug, contactedIds.size, 'exclude')
    this.assertUnderCap(organizationSlug, bucketIds.size, 'include')
    return {
      kind: 'override',
      idOverrides: {
        ...(bucketIds.size ? { include: [...bucketIds] } : {}),
        ...(contactedIds.size ? { exclude: [...contactedIds] } : {}),
      },
    }
  }

  private finalizeInSet(
    organizationSlug: string,
    idSet: Set<string>,
  ): IdFilterResolution {
    if (idSet.size === 0) return { kind: 'empty' }
    this.assertUnderCap(organizationSlug, idSet.size, 'include')
    return { kind: 'filter', idFilter: { in: [...idSet] } }
  }

  private finalizeNotInSet(
    organizationSlug: string,
    idSet: Set<string>,
  ): IdFilterResolution {
    if (idSet.size === 0) return { kind: 'none' }
    this.assertUnderCap(organizationSlug, idSet.size, 'exclude')
    return { kind: 'filter', idFilter: { notIn: [...idSet] } }
  }

  private assertUnderCap(
    organizationSlug: string,
    size: number,
    side: 'include' | 'exclude',
  ): void {
    if (size <= MAX_RESOLVED_ID_SET_SIZE) return
    this.logger.warn(
      { organizationSlug, size, side, cap: MAX_RESOLVED_ID_SET_SIZE },
      'contacts-made filter resolved too many people',
    )
    throw new BadRequestException(
      'This filter resolves too many people to apply directly — narrow ' +
        'the contacts-made selection.',
    )
  }
}
