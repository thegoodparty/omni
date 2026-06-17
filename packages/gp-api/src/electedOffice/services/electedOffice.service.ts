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
import { MeetingBriefingsService } from '@/meetings/services/meetingBriefings.service'
import { ListElectedOfficePaginationSchema } from '../schemas/ListElectedOfficePagination.schema'

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
  ) {
    super()
  }

  async create(args: CreateElectedOfficeArgs) {
    const existingForUser = await this.model.findMany({
      where: { userId: args.userId },
    })

    const newStart = args.termStartDate ?? null
    const newEnd = args.termEndDate ?? null
    const hasNewTerm = Boolean(newStart || newEnd)

    if (hasNewTerm) {
      // Core invariant: a user may hold multiple elected offices over time, but
      // their term date ranges must never overlap.
      const overlapping = existingForUser.find((eo) =>
        dateRangesOverlap(eo.termStartDate, eo.termEndDate, newStart, newEnd),
      )
      if (overlapping) {
        // A prior call may have committed the row but crashed before dispatching
        // the schedule. When the overlap is the very same office (identical term
        // start), treat this as an idempotent retry and re-dispatch instead of
        // failing. onElectedOfficeCreated tolerates re-dispatch.
        if (isSameDay(overlapping.termStartDate, newStart)) {
          await this.dispatchScheduleAfterCreate(overlapping)
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
      const existing = existingForUser[0]
      await this.dispatchScheduleAfterCreate(existing)
      return existing
    }

    const orgData = args.orgData ?? {
      positionId: null,
      customPositionName: null,
      overrideDistrictId: null,
    }

    const created = await this.client.$transaction(async (tx) => {
      const id = uuidv7()

      await tx.organization.create({
        data: {
          slug: OrganizationsService.electedOfficeOrgSlug(id),
          ownerId: args.userId,
          ...orgData,
        },
      })

      return tx.electedOffice.create({
        data: {
          id,
          swornInDate: args.swornInDate,
          electedDate: args.electedDate,
          termStartDate: args.termStartDate,
          termEndDate: args.termEndDate,
          termLengthDays: args.termLengthDays,
          isActive: args.isActive,
          party: args.party,
          pledgedAt: args.pledgedAt,
          onboardingCompletedAt: args.onboardingCompletedAt,
          userId: args.userId,
          campaignId: args.campaignId,
          organizationSlug: OrganizationsService.electedOfficeOrgSlug(id),
        },
      })
    })

    await this.dispatchScheduleAfterCreate(created)

    return created
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
