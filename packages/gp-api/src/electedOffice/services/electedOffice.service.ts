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
import { differenceInCalendarDays } from 'date-fns'
import { MeetingBriefingsService } from '@/meetings/services/meetingBriefings.service'
import { PrioritiesService } from '@/priorities/services/priorities.service'
import { ListElectedOfficePaginationSchema } from '../schemas/ListElectedOfficePagination.schema'
import { ELECTED_OFFICE_CREATE_ADVISORY_LOCK_KEY } from '../electedOffice.consts'

export type CreateElectedOfficeArgs = {
  swornInDate?: Date | null
  electedDate?: Date | null
  termStartDate?: Date | null
  termEndDate?: Date | null
  termLengthDays?: number | null
  isActive?: boolean
  party?: string | null
  pledgedAt?: Date | null
  onboardingCompletedAt?: Date | null
  userId: number
  campaignId?: number
  orgData?: {
    positionId: string | null
    customPositionName: string | null
    overrideDistrictId: string | null
  }
}

/**
 * Whether two term date ranges overlap. Open-ended bounds (null) are treated as
 * -Infinity (start) / +Infinity (end). A range with no bounds at all cannot be
 * compared, so it is treated as non-overlapping.
 */
export const dateRangesOverlap = (
  aStart: Date | null,
  aEnd: Date | null,
  bStart: Date | null,
  bEnd: Date | null,
): boolean => {
  if (aStart === null && aEnd === null) return false
  if (bStart === null && bEnd === null) return false
  const aS = aStart ? aStart.getTime() : -Infinity
  const aE = aEnd ? aEnd.getTime() : Infinity
  const bS = bStart ? bStart.getTime() : -Infinity
  const bE = bEnd ? bEnd.getTime() : Infinity
  return aS <= bE && bS <= aE
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
  ) {
    super()
  }

  async create(args: CreateElectedOfficeArgs) {
    const newStart = args.termStartDate ?? null
    const newEnd = args.termEndDate ?? null
    // Term dates are to-the-day values supplied by onboarding input or the
    // BallotReady office-holder prefill — never derived from election cadence
    // (that only yields rough year-level specificity). Derive the term length
    // precisely from the two dates when both are present; otherwise honor an
    // explicitly provided value.
    const termLengthDays =
      args.termLengthDays ??
      (newStart && newEnd ? differenceInCalendarDays(newEnd, newStart) : null)

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
          // dated offices — keep the no-overlap invariant when filling it.
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
          if (overlapping && !isSameDay(overlapping.termStartDate, newStart)) {
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
        return tx.electedOffice.update({
          where: { id: placeholder.id },
          data: {
            termStartDate: newStart,
            termEndDate: newEnd,
            termLengthDays,
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
          // very same office (identical term start), return it so the
          // out-of-transaction dispatch below re-fires instead of failing.
          if (isSameDay(overlapping.termStartDate, newStart)) {
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
          termLengthDays,
          isActive: args.isActive,
          party: args.party,
          pledgedAt: args.pledgedAt,
          onboardingCompletedAt: args.onboardingCompletedAt,
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
    PaginatedResults<ElectedOffice>
  > {
    const where: Prisma.ElectedOfficeWhereInput = {
      ...(userId ? { userId } : {}),
    }

    return {
      data: await this.model.findMany({
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        where,
      }),
      meta: {
        total: await this.model.count({ where }),
        offset: skip,
        limit,
      },
    }
  }
}
