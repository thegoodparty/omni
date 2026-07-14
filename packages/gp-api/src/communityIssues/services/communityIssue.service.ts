import { S3Service } from '@/vendors/aws/services/s3.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { Injectable } from '@nestjs/common'
import {
  CommunityIssueList,
  CommunityIssuePriority,
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

// Cap on how many issues per list get flattened into the email event below.
const MAX_EMAIL_ISSUES = 5

type EmailIssueFields = {
  title: string
  summary: string
  priority: CommunityIssuePriority
}

// Flatten a ranked issue list into indexed scalar props (topIssue1Title,
// topIssue1Summary, topIssue1Priority, topIssue2Title, …) so a HubSpot email
// workflow can read them — HubSpot can't index into an array. See the
// instrument-analytics-event skill's emailable-events convention.
const flattenIssuesForEmail = (
  prefix: string,
  issues: EmailIssueFields[],
): Record<string, string> => {
  const out: Record<string, string> = {}
  issues.slice(0, MAX_EMAIL_ISSUES).forEach((issue, i) => {
    const n = i + 1
    out[`${prefix}${n}Title`] = issue.title
    out[`${prefix}${n}Summary`] = issue.summary
    out[`${prefix}${n}Priority`] = issue.priority
  })
  return out
}

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
    // A run whose issues ALL failed validation shouldn't wipe an org's feed via
    // the upsert's archive-by-omission. But a genuinely empty result (the agent
    // returned no issues and none were dropped) is a real "archive all" signal
    // — e.g. trending routinely empties — so let that through to the upsert.
    if (
      validation.artifact.issues.length === 0 &&
      validation.dropped.length > 0
    ) {
      this.logger.warn(
        { runId: run.runId, dropped: validation.dropped.length },
        'community-issue artifact: all issues failed validation — skipping upsert',
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
            select: { title: true, summary: true, priority: true },
            orderBy: { rank: Prisma.SortOrder.asc },
          }),
          this.model.findMany({
            where: {
              organizationSlug: run.organizationSlug,
              list: CommunityIssueList.trending,
              archivedAt: null,
            },
            select: { title: true, summary: true, priority: true },
            orderBy: { rank: Prisma.SortOrder.asc },
          }),
        ])
        if (topIssues.length > 0 && trendingIssues.length > 0) {
          void this.analytics
            .track(userId, EVENTS.CommunityIssues.InitialIssuesGenerated, {
              topIssueCount: topIssues.length,
              trendingIssueCount: trendingIssues.length,
              ...flattenIssuesForEmail('topIssue', topIssues),
              ...flattenIssuesForEmail('trendingIssue', trendingIssues),
            })
            .catch(() => undefined)
        }
      }
    }

    // High-priority trending issues newly created on a refresh run (never on
    // the org's first trending generation, where every issue is new). One
    // event per run, not one per issue, so a batch of new high-priority
    // issues doesn't fan out into a flood of identical-looking events.
    if (
      summary.list === CommunityIssueList.trending &&
      !summary.wasFirstGenerationForList &&
      summary.newHighPriorityTrending.length > 0
    ) {
      const issues: Record<string, string> = {}
      summary.newHighPriorityTrending
        .slice(0, MAX_EMAIL_ISSUES)
        .forEach((issue, i) => {
          const n = i + 1
          issues[`issue${n}Title`] = issue.title
          issues[`issue${n}Summary`] = issue.summary
        })
      void this.analytics
        .track(
          userId,
          EVENTS.CommunityIssues.HighPriorityTrendingIssuesCreated,
          {
            issueCount: summary.newHighPriorityTrending.length,
            ...issues,
          },
        )
        .catch(() => undefined)
    }

    // An existing main-list issue whose priority moved this refresh — answers
    // "is something on the main list changing in urgency?". Only top_community
    // changes are collected, and these only occur on refreshes (a first
    // generation has no existing issues to change).
    for (const issue of summary.topPriorityChanges) {
      void this.analytics
        .track(userId, EVENTS.CommunityIssues.TopIssuePriorityChanged, {
          issueId: issue.id,
          title: issue.title,
          summary: issue.summary,
          previousPriority: issue.previousPriority,
          priority: issue.priority,
        })
        .catch(() => undefined)
    }
  }
}
