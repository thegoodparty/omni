import { Injectable, NotFoundException } from '@nestjs/common'
import { subDays, subMonths } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import {
  ArtifactReview,
  ArtifactReviewResourceType,
  Prisma,
} from '@/generated/prisma'
import {
  BriefingAdminListQuery,
  BriefingAdminRow,
  BriefingDateRangeFilter,
  BriefingReviewStatusFilter,
  PaginatedList,
} from '@goodparty_org/contracts'
import { ArtifactReviewService } from '@/artifactReview/services/artifactReview.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { DEFAULT_PAGINATION_OFFSET } from '@/shared/constants/paginationOptions.consts'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

type BriefingWithRelations = Prisma.MeetingBriefingGetPayload<{
  include: {
    electedOffice: { include: { user: true; organization: true } }
  }
}>

// user is typed nullable because ElectedOffice.user is an optional relation,
// but the userId FK is required — a briefing without an owner is impossible.
// The null branch is defensive and drops nothing in practice.
const toRow = (
  b: BriefingWithRelations,
  review: ArtifactReview | null,
): BriefingAdminRow | null => {
  const user = b.electedOffice.user
  if (!user) return null
  return {
    briefingId: b.id,
    meetingDate: formatInTimeZone(b.meetingDate, 'UTC', 'yyyy-MM-dd'),
    meetingName: b.artifact?.meeting_name ?? null,
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    },
    electedOffice: {
      id: b.electedOffice.id,
      organizationSlug: b.electedOffice.organizationSlug,
      positionName: b.electedOffice.organization.customPositionName,
    },
    updatedAt: b.updatedAt,
    review: review
      ? {
          verdict: review.verdict,
          failReason: review.failReason,
          reviewerEmail: review.reviewerEmail,
          reviewedAt: review.updatedAt,
        }
      : null,
  }
}

@Injectable()
export class AdminBriefingsService extends createPrismaBase(
  MODELS.MeetingBriefing,
) {
  constructor(private readonly artifactReviews: ArtifactReviewService) {
    super()
  }

  async list({
    offset = DEFAULT_PAGINATION_OFFSET,
    limit = DEFAULT_LIMIT,
    q,
    dateRange,
    reviewStatus,
  }: BriefingAdminListQuery): Promise<PaginatedList<BriefingAdminRow>> {
    const take = Math.min(limit, MAX_LIMIT)
    const where: Prisma.MeetingBriefingWhereInput = {
      ...(q
        ? {
            electedOffice: {
              user: {
                OR: [
                  {
                    firstName: {
                      contains: q,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                  {
                    lastName: {
                      contains: q,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                  {
                    email: { contains: q, mode: Prisma.QueryMode.insensitive },
                  },
                ],
              },
            },
          }
        : {}),
      ...dateRangeWhere(dateRange),
      ...(await this.reviewStatusWhere(reviewStatus)),
    }

    const [briefings, total] = await Promise.all([
      this.model.findMany({
        where,
        orderBy: { updatedAt: Prisma.SortOrder.desc },
        skip: offset,
        take,
        include: {
          electedOffice: { include: { user: true, organization: true } },
        },
      }),
      this.model.count({ where }),
    ])

    const reviews = await this.artifactReviews.findForResources(
      ArtifactReviewResourceType.briefing,
      briefings.map((b) => b.id),
    )
    const reviewsById = new Map(reviews.map((r) => [r.resourceId, r]))

    return {
      data: briefings
        .map((b) => toRow(b, reviewsById.get(b.id) ?? null))
        .filter((r): r is BriefingAdminRow => r !== null),
      meta: { total, offset, limit: take },
    }
  }

  async get(id: string): Promise<BriefingAdminRow> {
    const briefing = await this.model.findUnique({
      where: { id },
      include: {
        electedOffice: { include: { user: true, organization: true } },
      },
    })
    const reviews = briefing
      ? await this.artifactReviews.findForResources(
          ArtifactReviewResourceType.briefing,
          [briefing.id],
        )
      : []
    const row = briefing ? toRow(briefing, reviews[0] ?? null) : null
    if (!row) throw new NotFoundException('Briefing not found')
    return row
  }

  // No FK exists between artifact_review and meeting_briefing, so the
  // filter resolves matching briefing ids in a pre-query.
  private async reviewStatusWhere(
    reviewStatus?: BriefingReviewStatusFilter,
  ): Promise<Prisma.MeetingBriefingWhereInput> {
    if (!reviewStatus) return {}
    if (reviewStatus === 'pending') {
      const reviewed = await this.client.artifactReview.findMany({
        where: { resourceType: ArtifactReviewResourceType.briefing },
        select: { resourceId: true },
      })
      return { id: { notIn: reviewed.map((r) => r.resourceId) } }
    }
    const matching = await this.client.artifactReview.findMany({
      where: {
        resourceType: ArtifactReviewResourceType.briefing,
        verdict: reviewStatus,
      },
      select: { resourceId: true },
    })
    return { id: { in: matching.map((r) => r.resourceId) } }
  }
}

const dateRangeWhere = (
  dateRange?: BriefingDateRangeFilter,
): Prisma.MeetingBriefingWhereInput => {
  if (!dateRange || dateRange === 'All time') return {}
  const now = new Date()
  const since =
    dateRange === 'last 12 months'
      ? subMonths(now, 12)
      : dateRange === 'last 30 days'
        ? subDays(now, 30)
        : subDays(now, 7)
  return { meetingDate: { gte: since } }
}
