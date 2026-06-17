import { OrganizationsService } from '@/organizations/services/organizations.service'
import { Inject, Injectable, forwardRef } from '@nestjs/common'
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
import { PrioritiesService } from '@/priorities/services/priorities.service'
import { ElectionsService } from '@/elections/services/elections.service'
import { isHeldOffice } from '@/campaigns/util/eligibility.util'
import { ListElectedOfficePaginationSchema } from '../schemas/ListElectedOfficePagination.schema'
import { ELECTED_OFFICE_CREATE_ADVISORY_LOCK_KEY } from '../electedOffice.consts'
import {
  deriveTermFields,
  DerivedTermFields,
} from '../util/electedOfficeTerm.util'

export type CreateElectedOfficeArgs = {
  swornInDate?: Date | null
  userId: number
  campaignId?: number
  orgData?: {
    positionId: string | null
    customPositionName: string | null
    overrideDistrictId: string | null
  }
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
    private readonly elections: ElectionsService,
  ) {
    super()
  }

  async create(args: CreateElectedOfficeArgs) {
    // Resolve the term length from the position's BallotReady cadence before
    // opening the transaction — the advisory lock below must not be held
    // across an election-api round-trip.
    const termFields = await this.resolveTermFields(args)

    const office = await this.client.$transaction(async (tx) => {
      // Serialize office creation per user. Task 01 removed the
      // @@unique([userId]) constraint that previously prevented a concurrent
      // double-submit, so this lock + the in-transaction held-office recheck
      // are now the only thing stopping two active offices + two orphan orgs.
      // pg_advisory_xact_lock auto-releases on commit/rollback — no TTL or
      // claim-row cleanup needed.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ELECTED_OFFICE_CREATE_ADVISORY_LOCK_KEY}::integer, ${args.userId}::integer)`

      const offices = await tx.electedOffice.findMany({
        where: { userId: args.userId },
      })
      const held = offices.find((office) => isHeldOffice(office, new Date()))
      // Idempotent / gated: a user already holding an office cannot gain a
      // second active one, so return the held record rather than insert. A
      // concurrent first create that committed while we waited on the lock
      // also lands here, so the loser returns the winner's office.
      if (held) {
        return held
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
          userId: args.userId,
          campaignId: args.campaignId,
          organizationSlug: OrganizationsService.electedOfficeOrgSlug(id),
          electedDate: termFields.electedDate,
          termStartAt: termFields.termStartAt,
          termEndAt: termFields.termEndAt,
          termLengthDays: termFields.termLengthDays,
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

  private async resolveTermFields(
    args: CreateElectedOfficeArgs,
  ): Promise<DerivedTermFields> {
    const raceId = await this.resolveCampaignRaceId(args.campaignId)
    const cadence = raceId
      ? await this.elections.getElectionFrequencyByBrHashId(raceId)
      : null
    return deriveTermFields({
      frequency: cadence?.frequency ?? [],
      electionDate: cadence?.electionDate ?? null,
      swornInDate: args.swornInDate,
    })
  }

  private async resolveCampaignRaceId(
    campaignId?: number,
  ): Promise<string | null> {
    if (!campaignId) return null
    const campaign = await this.client.campaign.findUnique({
      where: { id: campaignId },
      select: { details: true },
    })
    return campaign?.details.raceId ?? null
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
