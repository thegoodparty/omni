import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  SUPPORT_ANSWER_ROLLUP,
  SUPPORT_STATUS_UNKNOWN,
  SupportStatusRollup,
} from '../contactInteraction.types'

const rollupCaseArms = Prisma.join(
  Object.entries(SUPPORT_ANSWER_ROLLUP).map(
    ([answer, rollup]) => Prisma.sql`WHEN ${answer} THEN ${rollup}`,
  ),
  ' ',
)

@Injectable()
export class SupportStatusService extends createPrismaBase(
  MODELS.ContactInteractionDoorKnock,
) {
  async statusForPeople(
    organizationSlug: string,
    personIds: string[],
  ): Promise<Map<string, SupportStatusRollup>> {
    if (personIds.length === 0) {
      return new Map()
    }
    const rows = await this.client.$queryRaw<
      { personId: string; rollup: SupportStatusRollup }[]
    >(
      this.derivedStatusSql(
        organizationSlug,
        Prisma.sql`AND person_id IN (${Prisma.join(personIds)})`,
      ),
    )
    const derived = new Map(rows.map((row) => [row.personId, row.rollup]))
    return new Map(
      personIds.map((personId) => [
        personId,
        derived.get(personId) ?? SUPPORT_STATUS_UNKNOWN,
      ]),
    )
  }

  // 'unknown' here selects only people with interaction rows — people the
  // org never contacted are not enumerable from SQL. Filter resolution for
  // 'unknown' over the full voter universe must NOT-IN the complement.
  async personIdsByStatus(
    organizationSlug: string,
    rollups: SupportStatusRollup[],
  ): Promise<string[]> {
    if (rollups.length === 0) {
      return []
    }
    const rows = await this.client.$queryRaw<{ personId: string }[]>(
      Prisma.sql`
        SELECT "personId"
        FROM (${this.derivedStatusSql(organizationSlug, Prisma.empty)}) d
        WHERE d.rollup IN (${Prisma.join(rollups)})
      `,
    )
    return rows.map((row) => row.personId)
  }

  // Derivation policy: the most recent row with a non-null support_answer
  // per (organization_slug, person_id) wins; answered rows sort ahead of
  // null-answer rows so a newer null can never override an older answer,
  // and id DESC makes identical occurred_at values deterministic. The CTE
  // is the extension point: UNION ALL other contact_interaction_* tables
  // there once they carry support answers.
  private derivedStatusSql(
    organizationSlug: string,
    personFilter: Prisma.Sql,
  ): Prisma.Sql {
    return Prisma.sql`
      WITH interaction AS (
        SELECT
          organization_slug,
          person_id,
          occurred_at,
          id,
          support_answer::text AS support_answer
        FROM contact_interaction_door_knock
        WHERE organization_slug = ${organizationSlug} ${personFilter}
      )
      SELECT DISTINCT ON (organization_slug, person_id)
        person_id AS "personId",
        COALESCE(
          CASE support_answer ${rollupCaseArms} END,
          ${SUPPORT_STATUS_UNKNOWN}
        ) AS rollup
      FROM interaction
      ORDER BY
        organization_slug,
        person_id,
        (support_answer IS NOT NULL) DESC,
        occurred_at DESC,
        id DESC
    `
  }
}
