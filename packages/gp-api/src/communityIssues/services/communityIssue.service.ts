import { S3Service } from '@/vendors/aws/services/s3.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { Injectable } from '@nestjs/common'
import {
  CommunityIssueList,
  ExperimentRun,
  Prisma,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { EVENTS } from 'src/vendors/segment/segment.types'
import { validateCommunityIssuesArtifact } from '../communityIssueArtifact.validation'
import {
  CommunityIssueUpsertService,
  CommunityIssueUpsertSummary,
} from './communityIssueUpsert.service'

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
    private readonly analytics: AnalyticsService,
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
        'community-issue artifact failed validation',
      )
      return
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
    const summary = await this.upsert.upsertFromArtifact(
      run,
      validation.artifact,
    )
    if (!summary) return

    await this.emitGenerationEvents(run, summary)
  }

  private async emitGenerationEvents(
    run: ExperimentRun,
    summary: CommunityIssueUpsertSummary,
  ): Promise<void> {
    const office = await this.client.electedOffice.findFirst({
      where: { organizationSlug: run.organizationSlug },
      select: { userId: true },
    })
    const userId = office?.userId
    if (!userId) {
      this.logger.warn(
        { runId: run.runId, organizationSlug: run.organizationSlug },
        'community-issue run: no elected office user; skipping analytics',
      )
      return
    }

    // Fires once per org, when the second of the two lists completes its
    // first-ever generation — i.e. the org now has both lists populated.
    // `otherListCount` counts all rows (live + archived) on purpose: it gates
    // on "has the other list ever generated", which is monotonic, so this
    // fires exactly once and never re-fires when a list later empties and
    // repopulates (trending routinely empties). The non-empty guard below
    // keeps us from emailing a list that currently has zero live issues.
    if (summary.wasFirstGenerationForList) {
      const otherList =
        summary.list === CommunityIssueList.top_community
          ? CommunityIssueList.trending
          : CommunityIssueList.top_community
      const otherListCount = await this.model.count({
        where: { organizationSlug: run.organizationSlug, list: otherList },
      })
      if (otherListCount > 0) {
        const [topIssues, trendingIssues] = await Promise.all([
          this.model.findMany({
            where: {
              organizationSlug: run.organizationSlug,
              list: CommunityIssueList.top_community,
              archivedAt: null,
            },
            select: { title: true, summary: true },
            orderBy: { rank: Prisma.SortOrder.asc },
          }),
          this.model.findMany({
            where: {
              organizationSlug: run.organizationSlug,
              list: CommunityIssueList.trending,
              archivedAt: null,
            },
            select: { title: true, summary: true },
            orderBy: { rank: Prisma.SortOrder.asc },
          }),
        ])
        if (topIssues.length > 0 && trendingIssues.length > 0) {
          void this.analytics
            .track(userId, EVENTS.CommunityIssues.InitialIssuesGenerated, {
              topIssueCount: topIssues.length,
              trendingIssueCount: trendingIssues.length,
              topIssues,
              trendingIssues,
            })
            .catch(() => undefined)
        }
      }
    }

    // A high-priority trending issue that is newly created on a refresh run
    // (never on the org's first trending generation, where every issue is new).
    if (
      summary.list === CommunityIssueList.trending &&
      !summary.wasFirstGenerationForList
    ) {
      for (const issue of summary.newHighPriorityTrending) {
        void this.analytics
          .track(
            userId,
            EVENTS.CommunityIssues.HighPriorityTrendingIssueCreated,
            {
              issueId: issue.id,
              title: issue.title,
              summary: issue.summary,
            },
          )
          .catch(() => undefined)
      }
    }
  }
}
