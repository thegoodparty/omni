import { OrganizationsService } from '@/organizations/services/organizations.service'
import {
  ConflictException,
  Inject,
  Injectable,
  forwardRef,
} from '@nestjs/common'
import { ElectedOffice, Organization, Prisma } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import {
  DEFAULT_PAGINATION_LIMIT,
  DEFAULT_PAGINATION_OFFSET,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_ORDER,
} from 'src/shared/constants/paginationOptions.consts'
import { PaginatedResults } from 'src/shared/types/utility.types'
import { v7 as uuidv7 } from 'uuid'
import {
  CommunityIssueDispatchService,
  EXPERIMENT_TYPES as COMMUNITY_ISSUE_EXPERIMENT_TYPES,
} from '@/communityIssues/services/communityIssueDispatch.service'
import {
  BRIEFING_EXPERIMENT_TYPE,
  MeetingBriefingsService,
  SCHEDULE_EXPERIMENT_TYPE,
} from '@/meetings/services/meetingBriefings.service'
import { FIND_EXISTING_ORDINANCES } from '@/ordinances/ordinances.constants'
import { OrdinanceDispatchService } from '@/ordinances/services/ordinanceDispatch.service'
import { PrioritiesService } from '@/priorities/services/priorities.service'
import { ListElectedOfficePaginationSchema } from '../schemas/ListElectedOfficePagination.schema'
import { ELECTED_OFFICE_CREATE_ADVISORY_LOCK_KEY } from '../electedOffice.consts'
import {
  electedOfficeToApi,
  type ApiElectedOffice,
} from '../util/electedOffice.util'

// Every experiment type this feature's re-dispatch fan-out can fire. Scopes
// the no-redispatch warning's count so an unrelated run for the org (e.g. a
// draft-quality-loop run) can't mask a genuine zero-dispatch outcome.
const SERVE_REDISPATCH_EXPERIMENT_TYPES: string[] = [
  SCHEDULE_EXPERIMENT_TYPE,
  BRIEFING_EXPERIMENT_TYPE,
  FIND_EXISTING_ORDINANCES,
  ...COMMUNITY_ISSUE_EXPERIMENT_TYPES,
]

export type CreateElectedOfficeArgs = {
  swornInDate?: Date | null
  electedDate?: Date | null
  termStartDate?: Date | null
  termEndDate?: Date | null
  party?: string | null
  pledgedAt?: Date | null
  onboardingCompletedAt?: Date | null
  selfReported?: boolean
  onboardingStep?: string | null
  userId: number
  campaignId?: number
  orgData?: {
    positionId: string | null
    customPositionName: string | null
    overrideDistrictId: string | null
  }
}

/**
 * Whether two term date ranges overlap. A null END (with a non-null start) is an
 * indefinite open-ended term → treated as +Infinity, so it genuinely overlaps
 * any later term. A range with no bounds at all, OR a null START with a non-null
 * end, cannot be meaningfully compared, so it is treated as non-overlapping.
 *
 * The null-start/non-null-end case is the partial BallotReady prefill: a holder
 * can arrive with `startAt: null, endAt: <date>`, producing a stored
 * `(termStartDate: null, termEndDate: <date>)` row. Mapping its null start to
 * -Infinity would make it spuriously overlap (and 409) any later dated term for
 * the same user (e.g. a magic-link retry that finally carries real term dates).
 * Since the start is unknown we can't assert overlap; the P3 dashboard prompt
 * collects the missing start, after which it becomes a fully-dated, comparable
 * term again.
 *
 * Terms are half-open [start, end): termEndDate is the exclusive boundary at
 * which the next holder takes over (BallotReady reports a 4-year term as
 * e.g. 2020-01-01 → 2024-01-01), so consecutive terms that touch at a single
 * endpoint (term A ends the day term B begins) are NOT treated as overlapping.
 */
export const dateRangesOverlap = (
  aStart: Date | null,
  aEnd: Date | null,
  bStart: Date | null,
  bEnd: Date | null,
): boolean => {
  if (aStart === null && aEnd === null) return false
  if (bStart === null && bEnd === null) return false
  if (aStart === null && aEnd !== null) return false
  if (bStart === null && bEnd !== null) return false
  const aS = aStart ? aStart.getTime() : -Infinity
  const aE = aEnd ? aEnd.getTime() : Infinity
  const bS = bStart ? bStart.getTime() : -Infinity
  const bE = bEnd ? bEnd.getTime() : Infinity
  return aS < bE && bS < aE
}

const isSameDay = (a: Date | null, b: Date | null): boolean =>
  a !== null && b !== null && a.getTime() === b.getTime()

export type OfficeIdentity = {
  positionId: string | null
  overrideDistrictId: string | null
}

export type OfficeIdentityWriteResult = {
  electedOffice: ElectedOffice
  // null means initialization — nothing was invalidated because an org with
  // neither a position nor a district override can never have resolved a
  // serve context, so there is by construction no derived data. Re-dispatch
  // is still warranted, which is why this returns a result rather than null.
  invalidatedAt: Date | null
}

@Injectable()
export class ElectedOfficeService extends createPrismaBase(
  MODELS.ElectedOffice,
) {
  constructor(
    @Inject(forwardRef(() => MeetingBriefingsService))
    private readonly meetingBriefings: MeetingBriefingsService,
    @Inject(forwardRef(() => PrioritiesService))
    private readonly priorities: PrioritiesService,
    private readonly communityIssueDispatch: CommunityIssueDispatchService,
    private readonly ordinanceDispatch: OrdinanceDispatchService,
  ) {
    super()
  }

  async create(args: CreateElectedOfficeArgs) {
    const newStart = args.termStartDate ?? null
    const newEnd = args.termEndDate ?? null

    const { office, identityWriteResult } = await this.client.$transaction(
      async (tx) => {
        // Captured by the placeholder/prefill branch below and returned out of
        // the transaction — dispatch runs only after this commits, never
        // inside it (SQS + election-api I/O can't hold a DB connection open).
        let identityWriteResult: OfficeIdentityWriteResult | null = null

        // Serialize office creation per user. Task 01 removed the
        // @@unique([userId]) constraint, so this advisory lock is what stops
        // two concurrent creates from both passing the non-overlap check below
        // and inserting overlapping offices (+ orphan orgs).
        // pg_advisory_xact_lock auto-releases on commit/rollback — no TTL or
        // claim-row cleanup needed.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ELECTED_OFFICE_CREATE_ADVISORY_LOCK_KEY}::integer, ${args.userId}::integer)`

        const existingForUser = await tx.electedOffice.findMany({
          where: { userId: args.userId },
        })

        const hasNewTerm = Boolean(newStart || newEnd)
        const orgPrefill = args.orgData
        const hasOrgPrefill =
          !!orgPrefill &&
          (orgPrefill.positionId !== null ||
            orgPrefill.customPositionName !== null ||
            orgPrefill.overrideDistrictId !== null)

        // An existing office with no term range is a placeholder (e.g. a
        // magic-link lead provisioned before any BallotReady / onboarding
        // data). create() is idempotent per user, so adopt that office rather
        // than inserting a duplicate — a term-less placeholder never "overlaps"
        // a dated term, so without this guard a later dated create would slip
        // past the overlap check below.
        const placeholder = existingForUser.find(
          (eo) => eo.termStartDate === null && eo.termEndDate === null,
        )
        if (placeholder) {
          // When this call carries the data the placeholder was waiting for — a
          // BallotReady prefill (term dates and/or position) arriving after a
          // bare magic-link placeholder — fill it in now instead of dropping
          // it. Otherwise the admin prefill response would advertise
          // term/position data that never reached the database.
          if (!hasNewTerm && !hasOrgPrefill) {
            return { office: placeholder, identityWriteResult }
          }
          if (hasNewTerm) {
            // The placeholder itself has no term, but the user may hold other
            // dated offices — keep the no-overlap invariant when filling it.
            // Any overlapping dated office is a genuine conflict: the
            // idempotent-retry exemption used on the create path below cannot
            // apply here, because a previously-filled placeholder would no
            // longer have null term dates and so would not have matched the
            // placeholder finder above.
            const overlapping = existingForUser.find(
              (eo) =>
                eo.id !== placeholder.id &&
                dateRangesOverlap(
                  eo.termStartDate,
                  eo.termEndDate,
                  newStart,
                  newEnd,
                ),
            )
            if (overlapping) {
              throw new ConflictException(
                'Elected office term overlaps an existing elected office for this user',
              )
            }
          }
          if (hasOrgPrefill) {
            const orgSlug = OrganizationsService.electedOfficeOrgSlug(
              placeholder.id,
            )
            // Read before the write, inside the same tx, so this diff can't
            // race a concurrent identity change on the same org.
            const beforeOrg = await tx.organization.findUniqueOrThrow({
              where: { slug: orgSlug },
              select: { positionId: true, overrideDistrictId: true },
            })
            const updatedOrg = await tx.organization.update({
              where: { slug: orgSlug },
              data: { ...orgPrefill },
            })
            identityWriteResult = await this.onOfficeIdentityWritten({
              organizationSlug: orgSlug,
              before: beforeOrg,
              after: {
                positionId: updatedOrg.positionId,
                overrideDistrictId: updatedOrg.overrideDistrictId,
              },
              tx,
            })
          }
          if (!hasNewTerm) {
            return { office: placeholder, identityWriteResult }
          }
          // Adopt the placeholder with the FULL payload this call carries, not
          // just the term dates. A single onboarding-completion POST sends term
          // dates alongside fields like party/pledgedAt/onboardingCompletedAt;
          // writing only the dates would silently drop the rest and leave the
          // record half-finished. Undefined fields are ignored by Prisma, so
          // partial prefills still only touch what they provide.
          const adopted = await tx.electedOffice.update({
            where: { id: placeholder.id },
            data: {
              termStartDate: newStart,
              termEndDate: newEnd,
              swornInDate: args.swornInDate,
              electedDate: args.electedDate,
              party: args.party,
              pledgedAt: args.pledgedAt,
              onboardingCompletedAt: args.onboardingCompletedAt,
              // undefined leaves the placeholder's existing value untouched, so
              // a prefill completion never clobbers it; a net-new completion
              // sets it.
              selfReported: args.selfReported,
              onboardingStep: args.onboardingStep,
            },
          })
          return { office: adopted, identityWriteResult }
        }

        if (hasNewTerm) {
          // Core invariant: a user may hold multiple elected offices over time,
          // but their term date ranges must never overlap. The advisory lock
          // above guarantees this check and the insert below are atomic per
          // user.
          const overlapping = existingForUser.find((eo) =>
            dateRangesOverlap(
              eo.termStartDate,
              eo.termEndDate,
              newStart,
              newEnd,
            ),
          )
          if (overlapping) {
            // Idempotent retry: a prior call may have committed the row but
            // crashed before dispatching the schedule. When the overlap is the
            // very same office (identical term start AND end), return it so the
            // out-of-transaction dispatch below re-fires instead of failing.
            // Both bounds must match — a same-start/different-end call is a
            // term correction that must update (or conflict), not silently
            // no-op.
            if (
              isSameDay(overlapping.termStartDate, newStart) &&
              isSameDay(overlapping.termEndDate, newEnd)
            ) {
              return { office: overlapping, identityWriteResult }
            }
            throw new ConflictException(
              'Elected office term overlaps an existing elected office for this user',
            )
          }
        } else if (existingForUser.length > 0) {
          // No term dates provided (e.g. the legacy win→serve path). Preserve
          // the historical "one elected office per user" idempotency /
          // crash-recovery behavior by returning the existing record.
          const existing = existingForUser[0]
          if (existing) {
            return { office: existing, identityWriteResult }
          }
        }

        const orgData = args.orgData ?? {
          positionId: null,
          customPositionName: null,
          overrideDistrictId: null,
        }
        const id = uuidv7()

        await tx.organization.create({
          data: {
            slug: OrganizationsService.electedOfficeOrgSlug(id),
            ownerId: args.userId,
            ...orgData,
          },
        })

        const created = await tx.electedOffice.create({
          data: {
            id,
            swornInDate: args.swornInDate,
            electedDate: args.electedDate,
            termStartDate: args.termStartDate,
            termEndDate: args.termEndDate,
            party: args.party,
            pledgedAt: args.pledgedAt,
            onboardingCompletedAt: args.onboardingCompletedAt,
            selfReported: args.selfReported ?? false,
            onboardingStep: args.onboardingStep ?? null,
            userId: args.userId,
            campaignId: args.campaignId,
            organizationSlug: OrganizationsService.electedOfficeOrgSlug(id),
          },
        })

        await this.priorities.seedFromWin(created.id, tx)

        return { office: created, identityWriteResult }
      },
    )

    // Fires for both a fresh create and an idempotent return: a prior call may
    // have committed the row but crashed before dispatching the schedule, and
    // the dispatch is the only recovery path. onElectedOfficeCreated tolerates
    // re-dispatch. Kept outside the transaction so the lock isn't held across
    // the queue round-trip.
    await this.dispatchScheduleAfterCreate(office)

    // The placeholder-adoption org-prefill above can itself be a genuine
    // office-identity change (a placeholder org already carrying a resolved
    // position, later re-pointed) — not merely initialization, which
    // dispatchScheduleAfterCreate above already covers completely. Gate on
    // invalidatedAt, not just a non-null result: on initialization no run
    // could have existed yet (every dispatch gate requires a resolved
    // position), so there is nothing for onElectedOfficeCreated's COMPLETED
    // guard to suppress, and firing this fan-out too would double-dispatch
    // ordinances (its onElectedOfficeCreated call above is fire-and-forget,
    // so its run may not exist yet when this in-flight check runs). On a
    // genuine re-point, that guard WOULD suppress, which is exactly why this
    // change-aware dispatch is needed there — the two are not redundant.
    if (identityWriteResult?.invalidatedAt) {
      await this.dispatchAfterOfficeIdentityChange(identityWriteResult)
    }

    return office
  }

  private async dispatchScheduleAfterCreate(
    electedOffice: ElectedOffice,
  ): Promise<void> {
    await this.meetingBriefings
      .onElectedOfficeCreated(electedOffice)
      .catch((err: Error) => {
        this.logger.error(
          { err, electedOfficeId: electedOffice.id },
          'meeting schedule dispatch failed after EO created',
        )
      })

    await this.communityIssueDispatch
      .onElectedOfficeCreated(electedOffice)
      .catch((err: Error) => {
        this.logger.error(
          { err, electedOfficeId: electedOffice.id },
          'community issue dispatch failed after EO created',
        )
      })

    // Fire-and-forget: ordinance sourcing writes no signup-critical state, so
    // it must add zero latency to the create request. The daily refresh cron
    // recovers any org missed if the process dies before this settles, and the
    // one-time exists-guard makes that re-entry safe.
    void this.ordinanceDispatch
      .onElectedOfficeCreated(electedOffice)
      .catch((err: Error) => {
        this.logger.error(
          { err, electedOfficeId: electedOffice.id },
          'ordinance dispatch failed after EO created',
        )
      })
  }

  // Takes the caller's transaction client rather than opening its own: the
  // identity update and the invalidation writes must commit or roll back
  // together, or a failed invalidation leaves the org pointed at the new
  // office with the old office's derived data (and officeIdentityChangedAt)
  // intact — and unrecoverable, since a retry re-sends the same PATCH and
  // `before` is now the new value, so `changed` is false and this no-ops.
  // Only DB writes belong in here; anything non-transactional (the
  // dispatchAfterOfficeIdentityChange re-dispatch fan-out) must run in the
  // caller after the transaction commits, never inside it.
  async onOfficeIdentityWritten(params: {
    organizationSlug: string
    before: OfficeIdentity
    after: OfficeIdentity
    tx: Prisma.TransactionClient
  }): Promise<OfficeIdentityWriteResult | null> {
    const { organizationSlug, before, after, tx } = params
    const changed =
      before.positionId !== after.positionId ||
      before.overrideDistrictId !== after.overrideDistrictId
    if (!changed) return null

    const electedOffice = await tx.electedOffice.findFirst({
      where: { organizationSlug },
    })
    if (!electedOffice) return null

    // An org with neither a position nor a district override cannot resolve
    // a serve context (resolveServeContext needs state + positionName, and
    // both fall back through position/overrideDistrict), so nothing can
    // have dispatched and there is nothing to invalidate. A custom position
    // name plus a district override DOES resolve a context even with
    // positionId null, so the guard must require both fields to be null —
    // checking positionId alone would skip invalidation for that case.
    if (before.positionId === null && before.overrideDistrictId === null) {
      return { electedOffice, invalidatedAt: null }
    }

    // Sequential, not Promise.all: an interactive transaction client shares
    // one connection and can't run concurrent queries on it.
    const changedAt = new Date()
    const deletedLocations = await tx.meetingResourceLocation.deleteMany({
      where: { electedOfficeId: electedOffice.id },
    })
    const deletedCode = await tx.ordinanceCodeRecord.deleteMany({
      where: { organizationSlug },
    })
    const archivedIssues = await tx.communityIssue.updateMany({
      where: { organizationSlug, archivedAt: null },
      data: { archivedAt: changedAt },
    })
    await tx.organization.update({
      where: { slug: organizationSlug },
      data: { officeIdentityChangedAt: changedAt },
    })

    this.logger.info(
      {
        organizationSlug,
        electedOfficeId: electedOffice.id,
        previousPositionId: before.positionId,
        positionId: after.positionId,
        previousOverrideDistrictId: before.overrideDistrictId,
        overrideDistrictId: after.overrideDistrictId,
        deletedResourceLocations: deletedLocations.count,
        deletedOrdinanceCodeRecords: deletedCode.count,
        archivedCommunityIssues: archivedIssues.count,
      },
      'office_identity_changed: invalidated derived data',
    )

    return { electedOffice, invalidatedAt: changedAt }
  }

  // Post-commit fan-out for an office-identity change. Must be called after
  // the caller's transaction commits, never from inside it — dispatch does
  // SQS sends and election-api resolution, which would hold a DB connection
  // open across network I/O if run inside a transaction. Ordering matters:
  // onOfficeIdentityWritten's invalidation deletes the SCHEDULE resource
  // location, which dispatchSchedule reads as a hint. Dispatching first
  // would seed the new run with the old city's portal. Commit ordering
  // guarantees that here — invalidation is already committed by the time
  // this runs.
  async dispatchAfterOfficeIdentityChange(
    result: OfficeIdentityWriteResult,
  ): Promise<void> {
    const { electedOffice, invalidatedAt } = result

    await this.meetingBriefings
      .onOfficeIdentityChanged(electedOffice)
      .catch((err: Error) => {
        this.logger.error(
          { err, electedOfficeId: electedOffice.id },
          'meeting schedule re-dispatch failed after office identity change',
        )
      })

    await this.communityIssueDispatch
      .onOfficeIdentityChanged(electedOffice)
      .catch((err: Error) => {
        this.logger.error(
          { err, electedOfficeId: electedOffice.id },
          'community issue re-dispatch failed after office identity change',
        )
      })

    await this.ordinanceDispatch
      .onOfficeIdentityChanged(electedOffice)
      .catch((err: Error) => {
        this.logger.error(
          { err, electedOfficeId: electedOffice.id },
          'ordinance re-dispatch failed after office identity change',
        )
      })

    // invalidatedAt is null for initialization, which invalidated nothing —
    // there is nothing to warn about.
    if (!invalidatedAt) return

    // This whole check exists only to make a silent state visible — it must
    // never be able to fail the request it's observing. The identity change
    // and the three dispatches above have already committed/run by this
    // point, so a transient failure here (count or the re-fetch) gets logged
    // and swallowed rather than turning a successful change into a 500.
    try {
      const dispatched = await this.client.experimentRun.count({
        where: {
          organizationSlug: electedOffice.organizationSlug,
          experimentType: { in: SERVE_REDISPATCH_EXPERIMENT_TYPES },
          createdAt: { gte: invalidatedAt },
        },
      })
      if (dispatched === 0) {
        // positionId / overrideDistrictId live on Organization, not
        // ElectedOffice — re-fetch rather than threading `after` through the
        // post-commit result, since this only runs on the rare
        // no-redispatch path.
        const { positionId, overrideDistrictId } =
          await this.client.organization.findUniqueOrThrow({
            where: { slug: electedOffice.organizationSlug },
            select: { positionId: true, overrideDistrictId: true },
          })
        this.logger.warn(
          {
            organizationSlug: electedOffice.organizationSlug,
            electedOfficeId: electedOffice.id,
            positionId,
            overrideDistrictId,
          },
          'office_identity_changed_no_redispatch: derived data was ' +
            'invalidated but nothing re-dispatched; the org will stay ' +
            'empty until its position resolves and is serve-ICP',
        )
      }
    } catch (err) {
      this.logger.error(
        { err, electedOfficeId: electedOffice.id },
        'no-redispatch warning check failed after office identity change',
      )
    }
  }

  // Owns the transaction so the M2M district write and its invalidation
  // commit or roll back together — the same atomicity onOfficeIdentityWritten
  // itself requires of every caller. Kept here, not on OrganizationsService,
  // per the controller: it only needs to hand off the already-resolved
  // before/after identity and the new district.
  async setOverrideDistrict(params: {
    organizationSlug: string
    overrideDistrictId: string | null
    before: OfficeIdentity
  }): Promise<Organization> {
    const { updated, writeResult } = await this.client.$transaction(
      async (tx) => {
        const updated = await tx.organization.update({
          where: { slug: params.organizationSlug },
          data: { overrideDistrictId: params.overrideDistrictId },
        })

        const writeResult = await this.onOfficeIdentityWritten({
          organizationSlug: params.organizationSlug,
          before: params.before,
          after: {
            positionId: updated.positionId,
            overrideDistrictId: updated.overrideDistrictId,
          },
          tx,
        })

        return { updated, writeResult }
      },
    )

    if (writeResult) {
      await this.dispatchAfterOfficeIdentityChange(writeResult)
    }

    return updated
  }

  async update(args: Prisma.ElectedOfficeUpdateArgs) {
    return this.model.update(args)
  }

  delete(args: Prisma.ElectedOfficeDeleteArgs) {
    return this.model.delete(args)
  }

  async listElectedOffices({
    offset: skip = DEFAULT_PAGINATION_OFFSET,
    limit = DEFAULT_PAGINATION_LIMIT,
    sortBy = DEFAULT_SORT_BY,
    sortOrder = DEFAULT_SORT_ORDER,
    userId,
  }: ListElectedOfficePaginationSchema): Promise<
    PaginatedResults<ApiElectedOffice>
  > {
    const where: Prisma.ElectedOfficeWhereInput = {
      ...(userId ? { userId } : {}),
    }

    const records = await this.model.findMany({
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      where,
    })

    return {
      // Emit the public contract shape (with derived isActive/termLengthDays)
      // so the M2M list endpoint matches the rest of the elected-office API.
      data: records.map((record) => electedOfficeToApi(record)),
      meta: {
        total: await this.model.count({ where }),
        offset: skip,
        limit,
      },
    }
  }
}
