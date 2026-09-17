import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { ElectedOffice, ExperimentRunStatus } from '../../generated/prisma'
import { MeetingBriefingFull } from '@/generated/agent-job-contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { parseIsoDateAsUTC } from 'src/shared/util/date.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { BriefingSeedRequestDto } from '../schemas/briefingSeed.schema'
import { SEED_BUCKET } from '../util/seedBucket'

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

    const artifactKey = `briefing-seed/${electedOffice.id}/${body.meetingDate}.json`
    const existing = await this.model.findUnique({
      where: {
        electedOfficeId_meetingDate: {
          electedOfficeId: electedOffice.id,
          meetingDate: parseIsoDateAsUTC(body.meetingDate),
        },
      },
      select: { experimentRunId: true },
    })

    // Recycle only a run this endpoint created — matched on the seed's own
    // deterministic artifactKey. Two failure modes bound this: minting a run
    // every re-seed leaves the previous one dereferenced forever (nothing
    // cascades from MeetingBriefing back to ExperimentRun), while blindly
    // reusing whatever run is attached would overwrite a REAL agent run's
    // artifact pointer with the seed's, orphaning the real artifact in S3 and
    // serving dummy data for that briefing from then on.
    const priorSeedRun = existing?.experimentRunId
      ? await this.client.experimentRun.findFirst({
          where: { runId: existing.experimentRunId, artifactKey },
          select: { runId: true },
        })
      : null

    // An existing row whose run is not one of ours belongs to a real agent
    // briefing, and the recycling guard above only keeps the seed off that
    // run's own row — it does nothing about the briefing row, which the update
    // branch below would repoint wholesale (experimentRunId, both pointer
    // columns, the JSONB cache). That strands the agent's artifact in S3, since
    // nothing cascades from MeetingBriefing back to ExperimentRun and the real
    // run survives only as a row nothing references, and serves dummy data for
    // that (office, date) from then on.
    //
    // Refusing outright rather than quietly leaving the row alone, which is the
    // shape CommunityIssueSeedService uses for its `update: {}`: there the
    // briefing row is incidental (it needs only `briefing.id` to anchor a
    // MeetingBriefingItemLink), whereas here the briefing is the entire product
    // of the call. A no-op would still answer 201 with a briefingId and
    // seed-item-N ids that appear nowhere in the artifact readers get back, so
    // the caller — always an e2e test — would fail on a missing-content
    // timeout several steps later instead of on the actual reason.
    //
    // The pre-fix bucket/key = "seed" signature is deliberately not
    // special-cased here. Only CommunityIssueSeedService ever wrote that pair,
    // and it repairs rows carrying it against this same unique constraint, so
    // a broken row heals there regardless of which seed endpoint is called.
    if (existing && !priorSeedRun) {
      throw new ConflictException(
        'A briefing already exists for this meeting date and was not created by this endpoint',
      )
    }

    const artifact = buildArtifact(body)
    const serialized = JSON.stringify(artifact)

    // The upload has to happen before either pointer row is committed. Both
    // pointer columns are NOT NULL and every reader goes straight to S3, so a
    // committed row whose object is absent is a dead end for that (office,
    // date) that nothing in the product can repair — the endpoint fails on
    // every request until someone re-seeds or edits the database by hand. With
    // the writes ordered the other way around, one failed PUT was enough to
    // reach that state. The inverted failure is cheap and self-healing: a
    // failed row write leaves an unreferenced object at a key derived purely
    // from (electedOfficeId, meetingDate), which the next seed for the same
    // pair overwrites in place rather than accumulating.
    await this.s3.uploadFile(SEED_BUCKET, serialized, artifactKey, {
      contentType: 'application/json',
    })

    // The real write path caches the row's JSONB copy by parsing the S3 body
    // back out, so round-trip here too rather than casting the built object —
    // the cache then matches the object byte-for-byte.
    // JSON.parse returns unknown — no way to infer parsed shape at compile time
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const artifactJson = JSON.parse(
      serialized,
    ) as PrismaJson.MeetingBriefingArtifact

    const runData = {
      organizationSlug: electedOffice.organizationSlug,
      experimentType: 'meeting_briefing',
      status: ExperimentRunStatus.COMPLETED,
      artifactBucket: SEED_BUCKET,
      artifactKey,
    }

    // The run and the briefing commit together because the run exists only to
    // be pointed at: nothing cascades from MeetingBriefing back to
    // ExperimentRun, and the priorSeedRun lookup above reaches the run through
    // the briefing row. A run committed without its briefing would therefore be
    // invisible to the next re-seed, which would mint another one — the exact
    // leak the priorSeedRun recycling exists to avoid.
    const briefing = await this.client.$transaction(async (tx) => {
      const run = priorSeedRun
        ? await tx.experimentRun.update({
            where: { runId: priorSeedRun.runId },
            data: runData,
          })
        : await tx.experimentRun.create({ data: runData })

      // Both pointer fields come from the locals we uploaded with rather than
      // being read back off `run`. Prisma types the run's copies nullable (the
      // columns fill in only when a run completes), and the `?? SEED_BUCKET`
      // fallback that used to bridge that gap also meant any bucket sitting on
      // the ExperimentRun would have been copied onto the briefing row
      // unchallenged.
      return tx.meetingBriefing.upsert({
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
          artifactBucket: SEED_BUCKET,
          artifactKey,
          artifact: artifactJson,
        },
        update: {
          meetingTime: body.meetingTime,
          meetingTimezone: body.meetingTimezone,
          experimentRunId: run.runId,
          artifactBucket: SEED_BUCKET,
          artifactKey,
          artifact: artifactJson,
        },
      })
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
