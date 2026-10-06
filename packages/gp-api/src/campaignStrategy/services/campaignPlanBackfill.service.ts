import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { PrismaService } from '@/prisma/prisma.service'
import { isTestCampaign } from '@/users/util/users.util'
import {
  APPROX_COST_PER_CAMPAIGN_USD,
  BACKFILL_PLANS_PREVIEW_SIZE,
  BackfillPlansInput,
  BackfillPlansResponse,
} from '../schemas/backfillPlans.schema'
import { CampaignStrategyService } from './campaignStrategy.service'

// Who asked. AdminAuditInterceptor only fires on @Roles(admin) routes, and
// this one admits machine tokens instead, so the audit line is written here.
export type BackfillActor =
  | { userId: number; userEmail: string | null }
  | { m2mSubject: string | undefined }

export interface BackfillCandidate {
  id: number
  email: string | null
  createdAt: string
  electionDate: string | null
}

// One-time backfill for the campaigns the old campaign-story gate stranded:
// until the gate came off, the Campaign Plan tab refused to render without a
// finished story, so generation was never called for them and they have no
// plan content at all. Every new campaign now reaches generation through the
// normal path, so this is a migration behind an admin route, not a job.
// Delete it once the backlog is cleared.
//
// It reuses getOrGenerateStrategicLandscape rather than dispatching itself so
// the attempt-slot claim, run linking and tracker bootstrap stay in one place.
// That method is not safe against concurrent callers for the same campaign
// (the attempt cap bounds spend, it does not lock), so this runs campaigns
// serially and callers must not overlap requests.
@Injectable()
export class CampaignPlanBackfillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly strategy: CampaignStrategyService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CampaignPlanBackfillService.name)
  }

  // Eligibility mirrors the generation endpoint's own preconditions, so a
  // selected campaign is one that would actually generate: a resolvable race,
  // an election that has not passed, and no plan content yet. `isActive` and
  // `isDemo` match the weekly cron's cohort.
  //
  // "No plan yet" is the absence of BOTH persisted sections rather than the
  // absence of the row: a campaign whose generation failed half way has a row
  // with one marker set, and it should be picked up too.
  //
  // "Not passed" is GREATEST of the dates, not COALESCE. The service refuses
  // only when EVERY stored date has passed, so a returning candidate carrying
  // last cycle's general date alongside an upcoming primary is still
  // generable, and COALESCE, which prefers the general, would read that
  // campaign as expired. GREATEST ignores a NULL branch.
  //
  // Newest first: without the signup floor this cohort reaches back to 2023,
  // and a small first batch should hit the candidates the gate actually
  // stranded, not the oldest rows in the table.
  selectCandidates(createdSince: string): Promise<BackfillCandidate[]> {
    return this.prisma.$queryRaw<BackfillCandidate[]>`
      SELECT
        c.id,
        u.email,
        to_char(c.created_at, 'YYYY-MM-DD') AS "createdAt",
        GREATEST(
          CASE
            WHEN c.details->>'electionDate' ~ '^\\d{4}-\\d{2}-\\d{2}'
            THEN (c.details->>'electionDate')::date
          END,
          CASE
            WHEN c.details->>'primaryElectionDate' ~ '^\\d{4}-\\d{2}-\\d{2}'
            THEN (c.details->>'primaryElectionDate')::date
          END
        )::text AS "electionDate"
      FROM campaign c
      LEFT JOIN "user" u ON u.id = c.user_id
      LEFT JOIN campaign_strategy s ON s.campaign_id = c.id
      WHERE c.is_active = true
        AND c.is_demo = false
        AND c.created_at >= ${createdSince}::date
        AND COALESCE(c.details->>'raceId', '') <> ''
        AND GREATEST(
          CASE
            WHEN c.details->>'electionDate' ~ '^\\d{4}-\\d{2}-\\d{2}'
            THEN (c.details->>'electionDate')::date
          END,
          CASE
            WHEN c.details->>'primaryElectionDate' ~ '^\\d{4}-\\d{2}-\\d{2}'
            THEN (c.details->>'primaryElectionDate')::date
          END
        ) >= NOW()::date
        AND (
          s.id IS NULL
          OR s.opposition_persisted_at IS NULL
          OR s.opportunities_persisted_at IS NULL
        )
      ORDER BY c.id DESC
    `
  }

  async run(
    input: BackfillPlansInput,
    actor: BackfillActor,
  ): Promise<BackfillPlansResponse> {
    this.logger.info({
      ...actor,
      body: input,
      msg: 'Campaign plan backfill requested',
    })
    const all = await this.selectCandidates(input.createdSince)
    // Test campaigns short-circuit inside the endpoint, so dispatching for
    // them would be a no-op that still counts as work. Filtered here rather
    // than in SQL because the rule is an email predicate owned by users.util.
    const eligible = all.filter(
      (row) => !isTestCampaign({ user: { email: row.email } }),
    )
    const batch = input.apply ? eligible.slice(0, input.limit) : eligible

    const report = {
      apply: input.apply,
      createdSince: input.createdSince,
      eligible: eligible.length,
      testCampaignsSkipped: all.length - eligible.length,
      selected: batch.length,
      approxCostUsd: batch.length * APPROX_COST_PER_CAMPAIGN_USD,
      preview: batch
        .slice(0, BACKFILL_PLANS_PREVIEW_SIZE)
        .map(({ id, createdAt, electionDate }) => ({
          id,
          createdAt,
          electionDate,
        })),
    }

    if (!input.apply) return { ...report, outcomes: null }

    const outcomes = {
      dispatched: 0,
      skipped: 0,
      failed: 0,
      failures: [] as { id: number; reason: string }[],
    }

    for (const row of batch) {
      // Re-read with the user include the endpoint requires. A campaign that
      // vanished between the scan and here is a skip, not a failure.
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: row.id },
        include: { user: true },
      })
      if (!campaign) {
        outcomes.skipped += 1
        continue
      }

      try {
        const res =
          await this.strategy.getOrGenerateStrategicLandscape(campaign)
        if (res.status === 'failed') {
          outcomes.failed += 1
          outcomes.failures.push({
            id: row.id,
            reason: res.reason ?? 'failed',
          })
          continue
        }
        outcomes.dispatched += 1
      } catch (err) {
        // One campaign's bad data (no race, stale election) must not stop the
        // batch. The endpoint throws 400s for exactly those cases.
        outcomes.failed += 1
        outcomes.failures.push({
          id: row.id,
          reason: err instanceof Error ? err.message : String(err),
        })
        this.logger.error(
          { err, campaignId: row.id },
          'Campaign plan backfill failed for campaign',
        )
      }
    }

    this.logger.info(
      {
        ...actor,
        ...outcomes,
        failures: undefined,
        createdSince: input.createdSince,
      },
      'Campaign plan backfill batch finished',
    )

    return { ...report, outcomes }
  }
}
