import { ForbiddenException, Injectable } from '@nestjs/common'
import { ElectedOffice, ExperimentRunStatus } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { parseIsoDateAsUTC } from 'src/shared/util/date.util'
import { SEED_BUCKET } from '@/meetings/util/seedBucket'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { CommunityIssuesArtifact } from '../communityIssueArtifact.validation'
import { SeedRequestDto } from '../schemas/communityIssues.schema'
import { CommunityIssueUpsertService } from './communityIssueUpsert.service'

// The seed endpoint exists only to give e2e tests deterministic data without
// the real (slow, non-deterministic, credit-spending) agent run. It is a write
// seam into customer-shaped data, so it must never be reachable on the prod or
// qa deploys. OTEL_SERVICE_ENVIRONMENT is the only signal that reliably names
// the deploy (NODE_ENV is pinned to 'production' in every Docker image), so
// gate on an allow-list: any unknown or new deploy environment fails closed.
// Every deployed task definition sets the variable unconditionally
// (deploy/index.ts), so unset can only mean a non-deployed context (local dev,
// vitest) and stays enabled. Read live so a test can stub the env per-case.
const SEED_ENABLED_ENVIRONMENTS = new Set(['local', 'test', 'preview', 'dev'])

const isSeedEnabled = () => {
  const env = process.env.OTEL_SERVICE_ENVIRONMENT
  return env === undefined || SEED_ENABLED_ENVIRONMENTS.has(env)
}

const EXPERIMENT_TYPE_FOR_LIST: Record<'top_community' | 'trending', string> = {
  top_community: 'top_community_issues',
  trending: 'trending_issues',
}

@Injectable()
export class CommunityIssueSeedService extends createPrismaBase(
  MODELS.CommunityIssue,
) {
  constructor(
    private readonly upsert: CommunityIssueUpsertService,
    private readonly s3: S3Service,
  ) {
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
      // No artifact pointers: this run's issues go straight into
      // upsertFromArtifact below, so its artifact never reaches S3 and the
      // columns have nothing truthful to hold. They are nullable precisely for
      // this case, and every consumer already treats null as "nothing to
      // fetch" (CommunityIssueService.onExperimentRunCompleted logs and
      // returns; AdminAgentRunsService.detail skips the GET). Naming a bucket
      // here instead would only give those readers a pointer that resolves to
      // someone else's bucket.
      const run = await this.client.experimentRun.create({
        data: {
          organizationSlug: org,
          experimentType: EXPERIMENT_TYPE_FOR_LIST[list],
          status: ExperimentRunStatus.COMPLETED,
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

      const existing = await this.client.meetingBriefing.findUnique({
        where: {
          electedOfficeId_meetingDate: {
            electedOfficeId: electedOffice.id,
            meetingDate: parseIsoDateAsUTC(meetingDate),
          },
        },
        select: { artifactBucket: true, artifactKey: true },
      })

      // An existing briefing normally keeps its own pointers: it may belong to
      // a real agent run, and repointing it at this stub would strand that
      // run's artifact in S3 and serve dummy data for that meeting from then
      // on. The one exception is a row carrying the exact pair this service
      // wrote before the fix below — bucket "seed", key "seed" — which is an
      // unambiguous signature rather than a heuristic. No writer in the repo
      // can produce that pair now: the agent path copies the bucket the broker
      // reports (gp-agent-artifacts-*), and both seeds write SEED_BUCKET under
      // a prefixed key. "seed" is also a real bucket owned by someone else in
      // ap-south-1, so no run of ours could ever have published there. A row
      // matching it is therefore broken, and broken by this code.
      //
      // Repairing it here is what turns the incident from a standing manual
      // chore into nothing: the e2e suite drives this endpoint on dev after
      // every merge with a fixed meeting date, so the next run repoints the
      // row that was answering `GET /v1/meetings/2026-07-01/briefing` with an
      // S3 PermanentRedirect 768 times a week. Seeding is rejected outright on
      // qa and prod (see isSeedEnabled), so a row like this cannot exist for a
      // customer and the repair can only ever touch dev and preview.
      //
      // This branch is disposable. It has no purpose once dev and preview hold
      // no rows with that signature — verify with `select count(*) from
      // meeting_briefing where artifact_bucket = 'seed'` and delete it.
      const repairsPreFixPointer =
        existing?.artifactBucket === 'seed' && existing.artifactKey === 'seed'

      // The row this creates only exists to anchor the MeetingBriefingItemLink
      // below, but it is a fully-fledged briefing pointer as far as every
      // reader is concerned: `GET /meetings/:date/briefing` and the PDF
      // renderer fetch artifactBucket/artifactKey from S3 unconditionally. So
      // the object goes up before the row that points at it, and only when
      // this call is actually going to write pointers — leaving someone else's
      // briefing alone means having nothing to upload.
      const artifact = {
        executive_summary: {
          items: [{ item_id: briefingItemId, content }],
        },
      }
      const artifactKey = `community-issue-seed/${electedOffice.id}/${meetingDate}.json`
      if (!existing || repairsPreFixPointer) {
        await this.s3.uploadFile(
          SEED_BUCKET,
          JSON.stringify(artifact),
          artifactKey,
          { contentType: 'application/json' },
        )
      }

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
          artifactBucket: SEED_BUCKET,
          artifactKey,
          artifact,
        },
        update: repairsPreFixPointer
          ? { artifactBucket: SEED_BUCKET, artifactKey, artifact }
          : {},
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
