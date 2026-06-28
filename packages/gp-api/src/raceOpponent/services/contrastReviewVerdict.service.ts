import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { RaceOpponentReview } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  ArtifactReviewResourceType,
  ArtifactReviewVerdict,
  RaceOpponentContrastStatus,
  User,
} from '@/generated/prisma'
import { ArtifactReviewService } from '@/artifactReview/services/artifactReview.service'

type SetForContrastInput = {
  contrastId: number
  reviewerSub: string | null
  reviewerUser: User | null
  verdict: ArtifactReviewVerdict
  failReason?: string
}

// Applies a fair-line review verdict to a contrast, mirroring
// BriefingReviewVerdictService: the verdict is persisted via the shared
// ArtifactReviewService (resourceType race_opponent_contrast), and the
// contrast's own status is moved out of the gate — passed -> cleared (now
// candidate-visible), failed -> blocked (stays hidden, carrying the reason).
@Injectable()
export class ContrastReviewVerdictService extends createPrismaBase(
  MODELS.RaceOpponentContrast,
) {
  constructor(private readonly artifactReviews: ArtifactReviewService) {
    super()
  }

  async setForContrast({
    contrastId,
    reviewerSub,
    reviewerUser,
    verdict,
    failReason,
  }: SetForContrastInput): Promise<RaceOpponentReview> {
    if (reviewerSub === null) {
      throw new ForbiddenException('review_requires_reviewer_identity')
    }

    const contrast = await this.model.findUnique({
      where: { id: contrastId },
      select: { id: true },
    })
    if (!contrast) {
      throw new NotFoundException('Contrast not found')
    }

    const failed = verdict === ArtifactReviewVerdict.failed
    if (failed && !failReason) {
      throw new BadRequestException('fail_requires_reason')
    }

    const row = await this.artifactReviews.setVerdict({
      resourceType: ArtifactReviewResourceType.race_opponent_contrast,
      resourceId: String(contrastId),
      verdict,
      failReason: failed ? (failReason ?? null) : null,
      reviewerClerkSub: reviewerSub,
      reviewerEmail: reviewerUser?.email ?? null,
    })

    await this.model.update({
      where: { id: contrastId },
      data: {
        status: failed
          ? RaceOpponentContrastStatus.blocked
          : RaceOpponentContrastStatus.cleared,
      },
    })

    return {
      verdict: row.verdict,
      failReason: row.failReason,
      reviewerEmail: row.reviewerEmail,
      reviewedAt: row.updatedAt,
    }
  }
}
