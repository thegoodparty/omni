import { S3Service } from '@/vendors/aws/services/s3.service'
import { Injectable } from '@nestjs/common'
import { ExperimentRun } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { validateCommunityIssuesArtifact } from '../communityIssueFeedArtifact.validation'
import { CommunityIssueFeedUpsertService } from './communityIssueFeedUpsert.service'

const COMMUNITY_ISSUE_EXPERIMENT_TYPES = new Set([
  'top_community_issues',
  'trending_issues',
])

@Injectable()
export class CommunityIssueFeedService extends createPrismaBase(
  MODELS.CommunityIssueFeed,
) {
  constructor(
    private readonly s3: S3Service,
    private readonly upsert: CommunityIssueFeedUpsertService,
  ) {
    super()
  }

  async onExperimentRunCompleted(run: ExperimentRun): Promise<void> {
    if (!COMMUNITY_ISSUE_EXPERIMENT_TYPES.has(run.experimentType)) return
    if (!run.artifactBucket || !run.artifactKey) {
      this.logger.warn(
        { runId: run.runId },
        'community-issue run completed without artifact location',
      )
      return
    }
    const raw = await this.s3.getFile(run.artifactBucket, run.artifactKey)
    if (!raw) {
      this.logger.warn(
        { runId: run.runId },
        'community-issue artifact S3 key returned nothing',
      )
      return
    }
    const parsed: unknown = JSON.parse(raw)
    const validation = validateCommunityIssuesArtifact(parsed)
    if (!validation.ok) {
      this.logger.error(
        { runId: run.runId, reason: validation.reason },
        'community-issue artifact failed validation',
      )
      return
    }
    await this.upsert.upsertFromArtifact(run, validation.artifact)
  }
}
