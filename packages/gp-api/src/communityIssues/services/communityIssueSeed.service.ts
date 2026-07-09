import { ForbiddenException, Injectable } from '@nestjs/common'
import { ElectedOffice, ExperimentRunStatus } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { parseIsoDateAsUTC } from 'src/shared/util/date.util'
import { CommunityIssuesArtifact } from '../communityIssueArtifact.validation'
import { SeedRequestDto } from '../schemas/communityIssues.schema'
import { CommunityIssueUpsertService } from './communityIssueUpsert.service'

// The seed endpoint exists only to give e2e tests deterministic data without
// the real (slow, non-deterministic, credit-spending) agent run. It is a write
// seam into customer-shaped data, so it must never be reachable on the prod or
// qa deploys. OTEL_SERVICE_ENVIRONMENT is the only signal that reliably names
// the deploy (NODE_ENV is pinned to 'production' in every Docker image), so gate
// on it: enabled on local/test/preview/dev, disabled on qa/prod. Read live so a
// test can stub the env per-case.
const SEED_DISABLED_ENVIRONMENTS = new Set(['qa', 'prod'])

const isSeedEnabled = () =>
  !SEED_DISABLED_ENVIRONMENTS.has(process.env.OTEL_SERVICE_ENVIRONMENT ?? '')

const EXPERIMENT_TYPE_FOR_LIST: Record<'top_community' | 'trending', string> = {
  top_community: 'top_community_issues',
  trending: 'trending_issues',
}

@Injectable()
export class CommunityIssueSeedService extends createPrismaBase(
  MODELS.CommunityIssue,
) {
  constructor(private readonly upsert: CommunityIssueUpsertService) {
    super()
  }

  async seed(electedOffice: ElectedOffice, body: SeedRequestDto) {
    if (!isSeedEnabled()) {
      throw new ForbiddenException('Seeding is disabled in this environment')
    }

    const org = electedOffice.organizationSlug
    const lists = [...new Set(body.issues.map((i) => i.list))]

    // Persist issues through the same upsertFromArtifact path the SQS completion
    // handler ultimately calls — one COMPLETED run + artifact per list — so the
    // seeded rows are produced by the real write logic, not hand-rolled inserts.
    const runByList = new Map<string, string>()
    for (const list of lists) {
      const run = await this.client.experimentRun.create({
        data: {
          organizationSlug: org,
          experimentType: EXPERIMENT_TYPE_FOR_LIST[list],
          status: ExperimentRunStatus.COMPLETED,
          artifactBucket: 'seed',
          artifactKey: 'seed',
        },
      })
      runByList.set(list, run.runId)
      const artifact: CommunityIssuesArtifact = {
        schema_version: 1,
        list,
        organization_slug: org,
        generated_for_run_id: run.runId,
        data_quality: 'ok',
        issues: body.issues
          .filter((i) => i.list === list)
          .map((i) => ({
            category: i.category,
            rank: i.rank,
            priority: i.priority,
            title: i.title,
            summary: i.summary,
            detail: i.detail,
          })),
      }
      await this.upsert.upsertFromArtifact(run, artifact)
    }

    const created = await this.model.findMany({
      where: { organizationSlug: org, archivedAt: null },
    })
    const idByKey = new Map(
      created.map((row) => [`${row.list}::${row.title}`, row]),
    )

    for (const issue of body.issues) {
      if (!issue.relatedBriefing) continue
      const row = idByKey.get(`${issue.list}::${issue.title}`)
      if (!row) continue
      const { meetingDate, briefingItemId, content } = issue.relatedBriefing
      const briefing = await this.client.meetingBriefing.upsert({
        where: {
          electedOfficeId_meetingDate: {
            electedOfficeId: electedOffice.id,
            meetingDate: parseIsoDateAsUTC(meetingDate),
          },
        },
        create: {
          electedOfficeId: electedOffice.id,
          meetingDate: parseIsoDateAsUTC(meetingDate),
          meetingTime: '18:00',
          meetingTimezone: 'America/New_York',
          experimentRunId: runByList.get(issue.list) ?? '',
          artifactBucket: 'seed',
          artifactKey: 'seed',
          artifact: {
            executive_summary: {
              items: [{ item_id: briefingItemId, content }],
            },
          },
        },
        update: {},
      })
      await this.client.meetingBriefingItemLink.upsert({
        where: {
          meetingBriefingId_briefingItemId: {
            meetingBriefingId: briefing.id,
            briefingItemId,
          },
        },
        create: {
          meetingBriefingId: briefing.id,
          briefingItemId,
          communityIssueId: row.id,
        },
        update: { communityIssueId: row.id },
      })
    }

    return {
      issues: body.issues.map((issue) => {
        const row = idByKey.get(`${issue.list}::${issue.title}`)
        return {
          id: row?.id ?? '',
          list: issue.list,
          rank: issue.rank,
          title: issue.title,
        }
      }),
    }
  }
}
