import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import {
  AnnotationKind,
  ArtifactReviewResourceType,
  ArtifactReviewVerdict,
  ElectedOffice,
  User,
} from '../../generated/prisma'
import { ArtifactReview as ArtifactReviewDTO } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { resolveBriefingId } from '@/meetings/util/resolveBriefingId'
import { ArtifactReviewService } from './artifactReview.service'

type SetForBriefingInput = {
  meetingDate: string
  electedOffice: ElectedOffice
  actorSub: string | null
  actorUser: User | null
  verdict: ArtifactReviewVerdict
  failReason?: string
}

@Injectable()
export class BriefingReviewVerdictService extends createPrismaBase(
  MODELS.MeetingBriefing,
) {
  constructor(private readonly artifactReviews: ArtifactReviewService) {
    super()
  }

  async setForBriefing({
    meetingDate,
    electedOffice,
    actorSub,
    actorUser,
    verdict,
    failReason,
  }: SetForBriefingInput): Promise<ArtifactReviewDTO> {
    if (actorSub === null) {
      throw new ForbiddenException('review_requires_impersonation')
    }
    const briefingId = await resolveBriefingId(
      this.client,
      meetingDate,
      electedOffice,
    )

    if (verdict === ArtifactReviewVerdict.failed && !failReason) {
      const reviewComments = await this.client.annotation.count({
        where: {
          resourceType: 'briefing',
          resourceId: briefingId,
          kind: AnnotationKind.review,
        },
      })
      if (reviewComments === 0) {
        throw new BadRequestException('fail_requires_reason_or_comments')
      }
    }

    const row = await this.artifactReviews.setVerdict({
      resourceType: ArtifactReviewResourceType.briefing,
      resourceId: briefingId,
      verdict,
      failReason:
        verdict === ArtifactReviewVerdict.failed ? (failReason ?? null) : null,
      reviewerClerkSub: actorSub,
      reviewerEmail: actorUser?.email ?? null,
    })
    return toDTO(row)
  }

  async getForBriefing(
    meetingDate: string,
    electedOffice: ElectedOffice,
    actorSub: string | null,
  ): Promise<ArtifactReviewDTO | null> {
    if (actorSub === null) {
      throw new ForbiddenException('review_requires_impersonation')
    }
    const briefingId = await resolveBriefingId(
      this.client,
      meetingDate,
      electedOffice,
    )
    const rows = await this.artifactReviews.findForResources(
      ArtifactReviewResourceType.briefing,
      [briefingId],
    )
    const row = rows[0]
    return row ? toDTO(row) : null
  }
}

const toDTO = (row: {
  verdict: ArtifactReviewVerdict
  failReason: string | null
  reviewerEmail: string | null
  updatedAt: Date
}): ArtifactReviewDTO => ({
  verdict: row.verdict,
  failReason: row.failReason,
  reviewerEmail: row.reviewerEmail,
  reviewedAt: row.updatedAt,
})
