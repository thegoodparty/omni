import { BadRequestException, Injectable } from '@nestjs/common'
import { DoorKnockOutcome, Prisma, SupportAnswer } from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import type {
  ActivityConditionAction,
  SupportStatusRollup,
} from '@goodparty_org/contracts'
import type { ActivityCondition } from '@/shared/schemas/activityCondition.schema'
import { SUPPORT_STATUS_UNKNOWN } from '../contactInteraction.types'
import { SupportStatusService } from './supportStatus.service'

// Mirrors people-api's MAX_ID_FILTER_VALUES
// (people-api/src/people/schemas/filters.schema.utils.ts). Enforced again
// here so an over-large resolution 400s with a filter-specific message
// before the wasted people-api round trip (which would otherwise reject the
// same set with a generic Zod error). Exported so other id-set producers
// against the same `id` transport (e.g. the opt-out scrub in
// p2pPhoneListUpload.service.ts) check against the same cap instead of
// duplicating the literal.
export const MAX_RESOLVED_ID_SET_SIZE = 100_000

export type IdFilterResolution =
  | { kind: 'none' }
  | { kind: 'empty' }
  | { kind: 'filter'; idFilter: { in: string[] } | { notIn: string[] } }

// Per-channel action -> SQL predicate. Enum columns are cast to text before
// comparison (mirrors supportStatus.service.ts's derivedStatusSql) rather
// than relying on Postgres to implicitly cast a bound text parameter to the
// column's enum type.
const TEXT_ACTION_PREDICATES: Partial<
  Record<ActivityConditionAction, Prisma.Sql>
> = {
  responded: Prisma.sql`responded_at IS NOT NULL`,
  no_response: Prisma.sql`responded_at IS NULL`,
  opted_out: Prisma.sql`opted_out_at IS NOT NULL`,
}

const ROBOCALL_ACTION_PREDICATES: Partial<
  Record<ActivityConditionAction, Prisma.Sql>
> = {
  answered: Prisma.sql`answered_at IS NOT NULL`,
  voicemail_left: Prisma.sql`voicemail_left_at IS NOT NULL`,
  no_answer: Prisma.sql`answered_at IS NULL AND voicemail_left_at IS NULL`,
}

const DOOR_KNOCK_ACTION_PREDICATES: Partial<
  Record<ActivityConditionAction, Prisma.Sql>
> = {
  answered: Prisma.sql`outcome::text = ${DoorKnockOutcome.answered}`,
  not_home: Prisma.sql`outcome::text = ${DoorKnockOutcome.not_home}`,
  refused_to_engage: Prisma.sql`outcome::text = ${DoorKnockOutcome.refused_to_engage}`,
  support_yes: Prisma.sql`support_answer::text = ${SupportAnswer.supporter}`,
  support_unsure: Prisma.sql`support_answer::text = ${SupportAnswer.unsure}`,
  support_no: Prisma.sql`support_answer::text = ${SupportAnswer.non_supporter}`,
}

// Empty actions = "membership only" (no outcome predicate at all), per the
// condition model's `actions` doc comment. Multiple selected actions OR
// within the condition (a row matching any of them counts).
const buildActionsPredicate = (
  actions: ActivityConditionAction[],
  predicateMap: Partial<Record<ActivityConditionAction, Prisma.Sql>>,
): Prisma.Sql | null => {
  if (actions.length === 0) return null
  const predicates = actions
    .map((action) => predicateMap[action])
    .filter((predicate): predicate is Prisma.Sql => predicate !== undefined)
  return Prisma.sql`(${Prisma.join(predicates, ' OR ')})`
}

const intersect = (a: Set<string>, b: Set<string>): Set<string> =>
  new Set([...a].filter((id) => b.has(id)))

// Conditions -> person-id sets, and the final composition with the
// support-status filter into the single `id` operator people-api accepts.
// Decision table (also see the ticket / TDD subproblem 3):
//   - No conditions, no supportStatus                -> none (no id filter)
//   - Conditions only                                 -> in = AND-intersection
//   - supportStatus only, no 'unknown'                -> in = union of statuses
//   - supportStatus only, includes 'unknown'          -> notIn = complement
//     (the non-selected KNOWN statuses) — 'unknown' only enumerates people
//     WITH interaction rows, so it can't be expressed as an `in` list.
//   - Conditions + supportStatus (no 'unknown')       -> in = intersection
//   - Conditions + supportStatus (incl. 'unknown')    -> in = conditions minus
//     the notIn-complement (collapses the mixed case to a single `in`,
//     since people-api accepts exactly one id operator per request).
// An empty final `in` set short-circuits (people-api's id filter requires
// min(1)); an empty final `notIn` set means "exclude nobody" and collapses
// to `none` (equivalent to no id filter — also required, since `notIn: []`
// would violate the same min(1)).
@Injectable()
export class ActivityConditionResolutionService extends createPrismaBase(
  MODELS.ContactInteractionText,
) {
  constructor(private readonly supportStatusService: SupportStatusService) {
    super()
  }

  async resolveIdFilter(
    organizationSlug: string,
    input: {
      activityConditions?: ActivityCondition[]
      supportStatus?: SupportStatusRollup[]
    },
  ): Promise<IdFilterResolution> {
    const conditions = input.activityConditions ?? []
    const supportStatuses = input.supportStatus ?? []

    if (conditions.length === 0 && supportStatuses.length === 0) {
      return { kind: 'none' }
    }

    let conditionSet: Set<string> | null = null
    for (const condition of conditions) {
      const set = await this.resolveCondition(organizationSlug, condition)
      conditionSet = conditionSet ? intersect(conditionSet, set) : set
      if (conditionSet.size === 0) break
    }

    if (supportStatuses.length === 0) {
      return this.finalizeInSet(organizationSlug, conditionSet ?? new Set())
    }

    const includesUnknown = supportStatuses.includes(SUPPORT_STATUS_UNKNOWN)

    if (!includesUnknown) {
      const supportSet = new Set(
        await this.supportStatusService.personIdsByStatus(
          organizationSlug,
          supportStatuses,
        ),
      )
      const finalSet = conditionSet
        ? intersect(conditionSet, supportSet)
        : supportSet
      return this.finalizeInSet(organizationSlug, finalSet)
    }

    const nonSelectedKnownStatuses = (
      ['supporter', 'non_supporter'] as const
    ).filter((rollup) => !supportStatuses.includes(rollup))
    const excludedSet = new Set(
      await this.supportStatusService.personIdsByStatus(
        organizationSlug,
        nonSelectedKnownStatuses,
      ),
    )

    if (!conditionSet) {
      return this.finalizeNotInSet(organizationSlug, excludedSet)
    }

    const finalSet = new Set(
      [...conditionSet].filter((id) => !excludedSet.has(id)),
    )
    return this.finalizeInSet(organizationSlug, finalSet)
  }

  private finalizeInSet(
    organizationSlug: string,
    idSet: Set<string>,
  ): IdFilterResolution {
    if (idSet.size === 0) return { kind: 'empty' }
    this.assertUnderCap(organizationSlug, idSet.size, 'in')
    return { kind: 'filter', idFilter: { in: [...idSet] } }
  }

  private finalizeNotInSet(
    organizationSlug: string,
    idSet: Set<string>,
  ): IdFilterResolution {
    if (idSet.size === 0) return { kind: 'none' }
    this.assertUnderCap(organizationSlug, idSet.size, 'notIn')
    return { kind: 'filter', idFilter: { notIn: [...idSet] } }
  }

  private assertUnderCap(
    organizationSlug: string,
    size: number,
    operator: 'in' | 'notIn',
  ): void {
    if (size <= MAX_RESOLVED_ID_SET_SIZE) return
    this.logger.warn(
      { organizationSlug, size, operator, cap: MAX_RESOLVED_ID_SET_SIZE },
      'activity-condition/support-status filter resolved too many people',
    )
    throw new BadRequestException(
      'This filter resolves too many people to apply directly — narrow ' +
        'the activity conditions or support status selection.',
    )
  }

  private async resolveCondition(
    organizationSlug: string,
    condition: ActivityCondition,
  ): Promise<Set<string>> {
    const { outreachType, outreachId, actions } = condition
    switch (outreachType) {
      case 'text':
      case 'p2p':
        return this.resolveText(
          organizationSlug,
          outreachId,
          outreachType,
          actions,
        )
      case 'robocall':
        return this.resolveRobocall(organizationSlug, outreachId, actions)
      case 'doorKnocking':
        return this.resolveDoorKnock(organizationSlug, actions)
      default:
        throw new BadRequestException(
          `Activity conditions aren't supported for the "${outreachType}" channel`,
        )
    }
  }

  // text and p2p share this one table with no per-row channel column — the
  // only way to tell them apart is the linked Outreach's outreachType. With
  // no outreachId pinned ("any campaign of this channel"), a bare
  // organization_slug scope would silently blend p2p-campaign responses into
  // a "text" condition (and vice versa). The LEFT JOIN lets manual rows
  // (outreach_id IS NULL — not tied to any campaign, so not attributable to
  // either channel specifically) count toward both; only rows tied to a
  // specific outreach are scoped to that outreach's actual type.
  private async resolveText(
    organizationSlug: string,
    outreachId: number | null | undefined,
    outreachType: 'text' | 'p2p',
    actions: ActivityConditionAction[],
  ): Promise<Set<string>> {
    const predicate = buildActionsPredicate(actions, TEXT_ACTION_PREDICATES)
    const rows = await this.client.$queryRaw<{ personId: string }[]>(Prisma.sql`
      SELECT DISTINCT contact_interaction_text.person_id AS "personId"
      FROM contact_interaction_text
      LEFT JOIN outreach ON outreach.id = contact_interaction_text.outreach_id
      WHERE contact_interaction_text.organization_slug = ${organizationSlug}
      ${
        outreachId != null
          ? Prisma.sql`AND contact_interaction_text.outreach_id = ${outreachId}`
          : Prisma.sql`AND (contact_interaction_text.outreach_id IS NULL OR outreach.outreach_type::text = ${outreachType})`
      }
      ${predicate ? Prisma.sql`AND ${predicate}` : Prisma.empty}
    `)
    return new Set(rows.map((row) => row.personId))
  }

  private async resolveRobocall(
    organizationSlug: string,
    outreachId: number | null | undefined,
    actions: ActivityConditionAction[],
  ): Promise<Set<string>> {
    const predicate = buildActionsPredicate(actions, ROBOCALL_ACTION_PREDICATES)
    const rows = await this.client.$queryRaw<{ personId: string }[]>(Prisma.sql`
      SELECT DISTINCT person_id AS "personId"
      FROM contact_interaction_robocall
      WHERE organization_slug = ${organizationSlug}
      ${outreachId != null ? Prisma.sql`AND outreach_id = ${outreachId}` : Prisma.empty}
      ${predicate ? Prisma.sql`AND ${predicate}` : Prisma.empty}
    `)
    return new Set(rows.map((row) => row.personId))
  }

  // Door-knock interactions carry no outreach linkage (VoterFileFilterService
  // rejects an outreachId on a doorKnocking condition at persistence time),
  // so there is no outreach scoping here.
  private async resolveDoorKnock(
    organizationSlug: string,
    actions: ActivityConditionAction[],
  ): Promise<Set<string>> {
    const predicate = buildActionsPredicate(
      actions,
      DOOR_KNOCK_ACTION_PREDICATES,
    )
    const rows = await this.client.$queryRaw<{ personId: string }[]>(Prisma.sql`
      SELECT DISTINCT person_id AS "personId"
      FROM contact_interaction_door_knock
      WHERE organization_slug = ${organizationSlug}
      ${predicate ? Prisma.sql`AND ${predicate}` : Prisma.empty}
    `)
    return new Set(rows.map((row) => row.personId))
  }
}
