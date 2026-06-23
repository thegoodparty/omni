import { OrganizationsService } from '@/organizations/services/organizations.service'
import {
  ConflictException,
  Inject,
  Injectable,
  forwardRef,
} from '@nestjs/common'
import { ElectedOffice, Prisma } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import {
  DEFAULT_PAGINATION_LIMIT,
  DEFAULT_PAGINATION_OFFSET,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_ORDER,
} from 'src/shared/constants/paginationOptions.consts'
import { PaginatedResults } from 'src/shared/types/utility.types'
import { v7 as uuidv7 } from 'uuid'
import { CommunityIssueDispatchService } from '@/communityIssues/services/communityIssueDispatch.service'
import { MeetingBriefingsService } from '@/meetings/services/meetingBriefings.service'
import { PrioritiesService } from '@/priorities/services/priorities.service'
import { ListElectedOfficePaginationSchema } from '../schemas/ListElectedOfficePagination.schema'
import { ELECTED_OFFICE_CREATE_ADVISORY_LOCK_KEY } from '../electedOffice.consts'
import {
  electedOfficeToApi,
  type ApiElectedOffice,
} from '../util/electedOffice.util'

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
  ) {
    super()
  }

  async create(args: CreateElectedOfficeArgs) {
    const newStart = args.termStartDate ?? null
    const newEnd = args.termEndDate ?? null

    const office = await this.client.$transaction(async (tx) => {
      // Serialize office creation per user. Task 01 removed the
      // @@unique([userId]) constraint, so this advisory lock is what stops two
      // concurrent creates from both passing the non-overlap check below and
      // inserting overlapping offices (+ orphan orgs). pg_advisory_xact_lock
      // auto-releases on commit/rollback — no TTL or claim-row cleanup needed.
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
      // magic-link lead provisioned before any BallotReady / onboarding data).
      // create() is idempotent per user, so adopt that office rather than
      // inserting a duplicate — a term-less placeholder never "overlaps" a
      // dated term, so without this guard a later dated create would slip past
      // the overlap check below.
      const placeholder = existingForUser.find(
        (eo) => eo.termStartDate === null && eo.termEndDate === null,
      )
      if (placeholder) {
        // When this call carries the data the placeholder was waiting for — a
        // BallotReady prefill (term dates and/or position) arriving after a
        // bare magic-link placeholder — fill it in now instead of dropping it.
        // Otherwise the admin prefill response would advertise term/position
        // data that never reached the database.
        if (!hasNewTerm && !hasOrgPrefill) {
          return placeholder
        }
        if (hasNewTerm) {
          // The placeholder itself has no term, but the user may hold other
          // dated offices — keep the no-overlap invariant when filling it. Any
          // overlapping dated office is a genuine conflict: the idempotent-retry
          // exemption used on the create path below cannot apply here, because a
          // previously-filled placeholder would no longer have null term dates
          // and so would not have matched the placeholder finder above.
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
          await tx.organization.update({
            where: {
              slug: OrganizationsService.electedOfficeOrgSlug(placeholder.id),
            },
            data: { ...orgPrefill },
          })
        }
        if (!hasNewTerm) {
          return placeholder
        }
        // Adopt the placeholder with the FULL payload this call carries, not
        // just the term dates. A single onboarding-completion POST sends term
        // dates alongside fields like party/pledgedAt/onboardingCompletedAt;
        // writing only the dates would silently drop the rest and leave the
        // record half-finished. Undefined fields are ignored by Prisma, so
        // partial prefills still only touch what they provide.
        return tx.electedOffice.update({
          where: { id: placeholder.id },
          data: {
            termStartDate: newStart,
            termEndDate: newEnd,
            swornInDate: args.swornInDate,
            electedDate: args.electedDate,
            party: args.party,
            pledgedAt: args.pledgedAt,
            onboardingCompletedAt: args.onboardingCompletedAt,
            // undefined leaves the placeholder's existing value untouched, so a
            // prefill completion never clobbers it; a net-new completion sets it.
            selfReported: args.selfReported,
            onboardingStep: args.onboardingStep,
          },
        })
      }

      if (hasNewTerm) {
        // Core invariant: a user may hold multiple elected offices over time,
        // but their term date ranges must never overlap. The advisory lock
        // above guarantees this check and the insert below are atomic per user.
        const overlapping = existingForUser.find((eo) =>
          dateRangesOverlap(eo.termStartDate, eo.termEndDate, newStart, newEnd),
        )
        if (overlapping) {
          // Idempotent retry: a prior call may have committed the row but
          // crashed before dispatching the schedule. When the overlap is the
          // very same office (identical term start AND end), return it so the
          // out-of-transaction dispatch below re-fires instead of failing. Both
          // bounds must match — a same-start/different-end call is a term
          // correction that must update (or conflict), not silently no-op.
          if (
            isSameDay(overlapping.termStartDate, newStart) &&
            isSameDay(overlapping.termEndDate, newEnd)
          ) {
            return overlapping
          }
          throw new ConflictException(
            'Elected office term overlaps an existing elected office for this user',
          )
        }
      } else if (existingForUser.length > 0) {
        // No term dates provided (e.g. the legacy win→serve path). Preserve the
        // historical "one elected office per user" idempotency / crash-recovery
        // behavior by returning the existing record.
        return existingForUser[0]
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

      return created
    })

    // Fires for both a fresh create and an idempotent return: a prior call may
    // have committed the row but crashed before dispatching the schedule, and
    // the dispatch is the only recovery path. onElectedOfficeCreated tolerates
    // re-dispatch. Kept outside the transaction so the lock isn't held across
    // the queue round-trip.
    await this.dispatchScheduleAfterCreate(office)

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
