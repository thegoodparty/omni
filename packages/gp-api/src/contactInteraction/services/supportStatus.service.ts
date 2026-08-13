import { Injectable } from '@nestjs/common'
import { ContactStatusField, Prisma } from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { SupportStatusRollupSchema } from '@goodparty_org/contracts'
import {
  DERIVED_SUPPORT_STATUS_VALUES,
  DerivedSupportStatusRollup,
  SUPPORT_ANSWER_ROLLUP,
  SUPPORT_STATUS_UNKNOWN,
  SupportStatusRollup,
} from '../contactInteraction.types'
import { ContactStatusService } from './contactStatus.service'

const rollupCaseArms = Prisma.join(
  Object.entries(SUPPORT_ANSWER_ROLLUP).map(
    ([answer, rollup]) => Prisma.sql`WHEN ${answer} THEN ${rollup}`,
  ),
  ' ',
)

const isDerivedRollup = (
  rollup: SupportStatusRollup,
): rollup is DerivedSupportStatusRollup =>
  (DERIVED_SUPPORT_STATUS_VALUES as readonly SupportStatusRollup[]).includes(
    rollup,
  )

@Injectable()
export class SupportStatusService extends createPrismaBase(
  MODELS.ContactInteractionDoorKnock,
) {
  constructor(private readonly contactStatusService: ContactStatusService) {
    super()
  }

  // The single override-aware entry point (ENG-10837): effective status =
  // override ?? derived. supporter/non_supporter/unknown can come from
  // either source (override wins per person); undecided/refused exist only
  // as overrides. Both list filtering (ActivityConditionResolutionService)
  // and counts must resolve support status through this method rather than
  // the raw derivation below, so a manually-set contact is never
  // double-counted under its stale derived bucket.
  async personIdsByEffectiveStatus(
    organizationSlug: string,
    rollups: SupportStatusRollup[],
  ): Promise<string[]> {
    if (rollups.length === 0) {
      return []
    }

    const matched = new Set(
      await this.contactStatusService.personIdsByFieldValue(
        organizationSlug,
        ContactStatusField.support_status,
        rollups,
      ),
    )

    const derivableRollups = rollups.filter(isDerivedRollup)
    if (derivableRollups.length === 0) {
      return [...matched]
    }

    // Every person with ANY support_status override, regardless of value —
    // override wins, so a derived match for one of these ids must be
    // dropped unless the override's own value already put it in `matched`
    // above.
    const overriddenPersonIds = new Set(
      await this.contactStatusService.personIdsByFieldValue(
        organizationSlug,
        ContactStatusField.support_status,
        [...SupportStatusRollupSchema.options],
      ),
    )

    const derivedIds = await this.personIdsByStatus(
      organizationSlug,
      derivableRollups,
    )
    for (const personId of derivedIds) {
      if (!overriddenPersonIds.has(personId)) {
        matched.add(personId)
      }
    }

    return [...matched]
  }

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

  // Pure derivation, no overrides — the building block
  // personIdsByEffectiveStatus composes with override reads. 'unknown' here
  // selects only people with interaction rows — people the org never
  // contacted are not enumerable from SQL. Filter resolution for 'unknown'
  // over the full voter universe must NOT-IN the complement.
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
