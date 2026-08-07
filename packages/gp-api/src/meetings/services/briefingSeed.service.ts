import { ForbiddenException, Injectable } from '@nestjs/common'
import { ElectedOffice, ExperimentRunStatus } from '../../generated/prisma'
import { MeetingBriefingFull } from '@/generated/agent-job-contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { parseIsoDateAsUTC } from 'src/shared/util/date.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { BriefingSeedRequestDto } from '../schemas/briefingSeed.schema'

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

// Both read paths for a briefing artifact (`GET /meetings/:date/briefing` and
// the public PDF renderer) fetch from S3 and 404 on a miss — the JSONB copy on
// the row is only a cache. A seeded briefing therefore has to land a real S3
// object, not just a row. gp-api already writes to the meeting pipeline bucket
// for briefing speech audio, so it is the bucket we are guaranteed to hold
// write access to in every non-prod deploy.
const SEED_BUCKET =
  process.env.MEETING_PIPELINE_BUCKET ?? 'meeting-pipeline-dev'

@Injectable()
export class BriefingSeedService extends createPrismaBase(
  MODELS.MeetingBriefing,
) {
  constructor(private readonly s3: S3Service) {
    super()
  }

  async seed(electedOffice: ElectedOffice, body: BriefingSeedRequestDto) {
    if (!isSeedEnabled()) {
      throw new ForbiddenException('Seeding is disabled in this environment')
    }

    const run = await this.client.experimentRun.create({
      data: {
        organizationSlug: electedOffice.organizationSlug,
        experimentType: 'meeting_briefing',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: SEED_BUCKET,
        artifactKey: `briefing-seed/${electedOffice.id}/${body.meetingDate}.json`,
      },
    })

    const artifact = buildArtifact(body)
    const serialized = JSON.stringify(artifact)
    await this.s3.uploadFile(
      SEED_BUCKET,
      serialized,
      // artifactKey is non-null on the row we just created, but Prisma types it
      // nullable because the column is only populated once a run completes.
      run.artifactKey ?? '',
      { contentType: 'application/json' },
    )
    // The real write path caches the row's JSONB copy by parsing the S3 body
    // back out, so round-trip here too rather than casting the built object —
    // the cache then matches the object byte-for-byte.
    // JSON.parse returns unknown — no way to infer parsed shape at compile time
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const artifactJson = JSON.parse(
      serialized,
    ) as PrismaJson.MeetingBriefingArtifact

    const briefing = await this.model.upsert({
      where: {
        electedOfficeId_meetingDate: {
          electedOfficeId: electedOffice.id,
          meetingDate: parseIsoDateAsUTC(body.meetingDate),
        },
      },
      create: {
        electedOfficeId: electedOffice.id,
        meetingDate: parseIsoDateAsUTC(body.meetingDate),
        meetingTime: body.meetingTime,
        meetingTimezone: body.meetingTimezone,
        experimentRunId: run.runId,
        artifactBucket: run.artifactBucket ?? SEED_BUCKET,
        artifactKey: run.artifactKey ?? '',
        artifact: artifactJson,
      },
      update: {
        meetingTime: body.meetingTime,
        meetingTimezone: body.meetingTimezone,
        experimentRunId: run.runId,
        artifactBucket: run.artifactBucket ?? SEED_BUCKET,
        artifactKey: run.artifactKey ?? '',
        artifact: artifactJson,
      },
    })

    return {
      briefingId: briefing.id,
      meetingDate: body.meetingDate,
      itemIds: artifact.items.map((item) => item.id),
    }
  }
}

const buildArtifact = (body: BriefingSeedRequestDto): MeetingBriefingFull => {
  const generatedAt = new Date(
    `${body.meetingDate}T00:00:00.000Z`,
  ).toISOString()

  const items = body.items.map((item, index) => {
    const id = `seed-item-${index + 1}`
    const sourceId = `seed-source-${index + 1}`
    return {
      id,
      item_number: `${index + 1}`,
      title: item.title,
      tier: 'featured' as const,
      tier_reason: ['Seeded for e2e coverage'] as [string, ...string[]],
      vote_required: true,
      display: {
        summary: item.summary,
        budget_impact: item.budgetImpactSummary
          ? {
              summary: item.budgetImpactSummary,
              source_ids: [sourceId],
              figures: [
                {
                  label: 'Total appropriation',
                  value: '$1,250,000',
                  source_id: sourceId,
                },
              ] as [{ label: string; value: string; source_id: string }],
            }
          : null,
        constituent_sentiment: item.sentimentSummary
          ? {
              summary: item.sentimentSummary,
              detail: null,
              district_note: null,
              haystaq_column: 'seed_column',
              haystaq_status: 'ok' as const,
              mean_score: 62,
              score_direction: 'higher_is_more_supportive',
              source_ids: [sourceId],
              voter_count: 4200,
            }
          : null,
        recent_news: null,
        talking_points: item.talkingPoints ?? null,
      },
      research: {
        full_treatment: null,
        raw_context: [
          {
            chunk_id: `seed-chunk-${index + 1}`,
            item_id: id,
            item_title: item.title,
            pages: [1] as [number, ...number[]],
            section_heading: null,
            source_id: sourceId,
            text: item.summary,
            tier: 'featured' as const,
          },
        ] as MeetingBriefingFull['items'][number]['research']['raw_context'],
      },
    }
  })

  const artifact = {
    briefing_status: 'briefing_ready' as const,
    briefing_type: 'city_council_meeting' as const,
    claims: [],
    disclosure:
      'Seeded briefing generated for automated tests. Not real research.',
    estimated_read_minutes: 4,
    executive_summary: {
      lead_in: `Seeded briefing for the ${body.meetingName} meeting.`,
      items: body.items.map((item, index) => ({
        item_id: `seed-item-${index + 1}`,
        title: item.title,
        overview: item.summary,
      })),
    },
    experiment_id: 'meeting_briefing_seed',
    generated_at: generatedAt,
    items,
    location: body.location,
    meeting_date: body.meetingDate,
    meeting_name: body.meetingName,
    meeting_time: body.meetingTime,
    meeting_timezone: body.meetingTimezone,
    official_name: body.officialName,
    required_data_points: [],
    run_metadata: {
      agenda_packet_url: null,
      discovered_agenda_location: null,
      source_bundle_retrieved_at: generatedAt,
    },
    sources: body.items.map((item, index) => ({
      id: `seed-source-${index + 1}`,
      name: `Agenda packet — ${item.title}`,
      source_type: 'agenda_packet' as const,
      retrieved_at: generatedAt,
      retrieved_text_or_snapshot: item.summary,
      url: 'https://example.gov/agenda.pdf',
    })),
  }

  // `items` and `executive_summary.items` are fixed-length tuple unions in the
  // generated agent contract; the request's item list is a plain array whose
  // length is only known at runtime (Zod caps it at 1-5, matching the union),
  // so no structural narrowing can produce the tuple type.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return artifact as unknown as MeetingBriefingFull
}
