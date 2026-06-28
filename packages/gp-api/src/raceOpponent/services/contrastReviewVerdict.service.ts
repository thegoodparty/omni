import {
  BadRequestException,
  ConflictException,
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

type SetForContrastInput = {
  contrastId: number
  reviewerSub: string | null
  reviewerUser: User | null
  verdict: ArtifactReviewVerdict
  failReason?: string
}

// Applies a fair-line review verdict to a contrast, mirroring
// BriefingReviewVerdictService: the verdict is persisted as the shared
// ArtifactReview record (resourceType race_opponent_contrast), and the
// contrast's own status is moved out of the gate — passed -> cleared (now
// candidate-visible), failed -> blocked (stays hidden, carrying the reason).
@Injectable()
export class ContrastReviewVerdictService extends createPrismaBase(
  MODELS.RaceOpponentContrast,
) {
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

    const failed = verdict === ArtifactReviewVerdict.failed
    if (failed && !failReason) {
      throw new BadRequestException('fail_requires_reason')
    }

    const reviewFields = {
      verdict,
      failReason: failed ? (failReason ?? null) : null,
      reviewerClerkSub: reviewerSub,
      reviewerEmail: reviewerUser?.email ?? null,
    }

    // The pending-review re-check, the ArtifactReview upsert, and the status
    // flip run in one transaction so two concurrent reviewers can't both pass
    // the gate (TOCTOU) and so a fault can't leave a written verdict against a
    // still-pending contrast. The in-tx updateMany scoped to pending_review is
    // the atomic claim: count 0 means another reviewer already moved it.
    const row = await this.client.$transaction(async (tx) => {
      const contrast = await tx.raceOpponentContrast.findUnique({
        where: { id: contrastId },
        select: { status: true },
      })
      if (!contrast) {
        throw new NotFoundException('Contrast not found')
      }
      if (contrast.status !== RaceOpponentContrastStatus.pending_review) {
        throw new ConflictException('Contrast is not pending review')
      }

      const claimed = await tx.raceOpponentContrast.updateMany({
        where: {
          id: contrastId,
          status: RaceOpponentContrastStatus.pending_review,
        },
        data: {
          status: failed
            ? RaceOpponentContrastStatus.blocked
            : RaceOpponentContrastStatus.cleared,
        },
      })
      if (claimed.count === 0) {
        throw new ConflictException('Contrast is not pending review')
      }

      return tx.artifactReview.upsert({
        where: {
          resourceType_resourceId: {
            resourceType: ArtifactReviewResourceType.race_opponent_contrast,
            resourceId: String(contrastId),
          },
        },
        create: {
          resourceType: ArtifactReviewResourceType.race_opponent_contrast,
          resourceId: String(contrastId),
          ...reviewFields,
        },
        update: reviewFields,
      })
    })

    return {
      verdict: row.verdict,
      failReason: row.failReason,
      reviewerEmail: row.reviewerEmail,
      reviewedAt: row.updatedAt,
    }
  }
}
