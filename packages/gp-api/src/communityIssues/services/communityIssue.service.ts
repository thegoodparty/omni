import { S3Service } from '@/vendors/aws/services/s3.service'
import { Injectable } from '@nestjs/common'
import { ExperimentRun } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { validateCommunityIssuesArtifact } from '../communityIssueArtifact.validation'
import { CommunityIssueUpsertService } from './communityIssueUpsert.service'

const COMMUNITY_ISSUE_EXPERIMENT_TYPES = new Set([
  'top_community_issues',
  'trending_issues',
])

// JSON.parse returns any; the result is passed straight into Zod safeParse
// which accepts unknown — no narrower type is available at this boundary.
const parseJson = (raw: string): Record<string, unknown> =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  JSON.parse(raw) as Record<string, unknown>

@Injectable()
export class CommunityIssueService extends createPrismaBase(
  MODELS.CommunityIssue,
) {
  constructor(
    private readonly s3: S3Service,
    private readonly upsert: CommunityIssueUpsertService,
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
    let parsed: Record<string, unknown>
    try {
      parsed = parseJson(raw)
    } catch (err) {
      this.logger.error(
        { runId: run.runId, err },
        'community-issue artifact is not valid JSON',
      )
      return
    }
    const validation = validateCommunityIssuesArtifact(parsed)
    if (!validation.ok) {
      this.logger.error(
        { runId: run.runId, reason: validation.reason },
        'community-issue artifact envelope failed validation',
      )
      return
    }
    if (validation.dropped.length > 0) {
      this.logger.warn(
        { runId: run.runId, dropped: validation.dropped },
        'community-issue artifact: dropped invalid issues, persisting the rest',
      )
    }
    if (
      validation.artifact.organization_slug !== run.organizationSlug ||
      validation.artifact.generated_for_run_id !== run.runId
    ) {
      this.logger.error(
        {
          runId: run.runId,
          artifactOrg: validation.artifact.organization_slug,
          runOrg: run.organizationSlug,
          artifactRunId: validation.artifact.generated_for_run_id,
        },
        'community-issue artifact org or run id does not match run — skipping',
      )
      return
    }
    // Don't run the upsert (which archives-by-omission) when nothing valid
    // survived — a run whose every issue failed validation shouldn't wipe an
    // org's existing feed.
    if (validation.artifact.issues.length === 0) {
      this.logger.warn(
        { runId: run.runId },
        'community-issue artifact has no valid issues — skipping upsert',
      )
      return
    }
    await this.upsert.upsertFromArtifact(run, validation.artifact)
  }
}
