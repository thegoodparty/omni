/**
 * One-time backfill: generate a campaign plan for the campaigns that never got
 * one.
 *
 * Until the campaign-story gate came off plan generation, the Campaign Plan tab
 * refused to render for a candidate with no story, so the generation endpoint
 * was never called for them and they have no `campaign_strategy` content at
 * all. That cohort is closed and fixed — every new campaign now reaches
 * generation through the normal path — so this is a migration, not a job.
 * Delete it once the backlog is cleared.
 *
 * Dispatching a plan also bootstraps the campaign tracker (the plan-completion
 * handler materializes the static rows and dispatches the initial CAP run), so
 * this one entry point fixes both surfaces.
 *
 * SPENDS MONEY. Each campaign dispatches two Fargate CAP sections plus, on
 * completion, one tracker generation (~$0.94). Dry run first, then widen with
 * --limit.
 *
 * Idempotent: a campaign with both plan sections persisted is never selected,
 * and `getOrGenerateStrategicLandscape` has its own in-flight and attempt-cap
 * dedup, so a re-run only picks up what an earlier pass could not finish.
 *
 * Usage (NOT tsx: esbuild drops emitDecoratorMetadata, so every Nest provider
 * would be constructed with undefined dependencies):
 *   node -r @swc-node/register -r tsconfig-paths/register \
 *     scripts/backfill-campaign-plans.ts                    # dry run
 *   node -r @swc-node/register -r tsconfig-paths/register \
 *     scripts/backfill-campaign-plans.ts --limit 10 --apply
 *
 * Required env: whatever gp-api itself needs to dispatch a CAP run —
 * DATABASE_URL, AGENT_DISPATCH_QUEUE_NAME, ELECTION_API_* , AWS credentials,
 * plus the secrets the module graph validates at boot.
 */
import '../src/configrc'

import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { CampaignsModule } from '../src/campaigns/campaigns.module'
import { CampaignStrategyModule } from '../src/campaignStrategy/campaignStrategy.module'
import { CampaignStrategyService } from '../src/campaignStrategy/services/campaignStrategy.service'
import { loggerModule } from '../src/observability/logging/logger-module'
import { PrismaModule } from '../src/prisma/prisma.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { isTestCampaign } from '../src/users/util/users.util'

// Rough per-campaign cost: two plan sections plus the tracker generation the
// completion handler dispatches. Only used to print an estimate in the dry run,
// so an order of magnitude is the point, not the decimals.
const APPROX_COST_PER_CAMPAIGN_USD = 2

const USAGE = `
Usage:
  node -r @swc-node/register -r tsconfig-paths/register \\
    scripts/backfill-campaign-plans.ts [--limit N] [--apply]

  --limit N   Only process the N oldest eligible campaigns.
  --apply     Dispatch. Without it, nothing is dispatched.
`

export interface Args {
  apply: boolean
  limit: number | null
}

export const parseArgs = (argv: string[]): Args => {
  const args: Args = { apply: false, limit: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--apply':
        args.apply = true
        break
      case '--limit': {
        const raw = argv[++i]
        const limit = Number(raw)
        if (!raw || !Number.isInteger(limit) || limit <= 0) {
          throw new Error(
            `--limit needs a positive integer, got "${raw ?? ''}"`,
          )
        }
        args.limit = limit
        break
      }
      case '--help':
      case '-h':
        console.log(USAGE)
        process.exit(0)
      default:
        throw new Error(`Unknown argument "${arg}"${USAGE}`)
    }
  }
  return args
}

export interface CandidateRow {
  id: number
  organizationSlug: string
  email: string | null
  electionDate: string | null
}

// Eligibility mirrors the generation endpoint's own preconditions, so a
// selected campaign is one that would actually generate: a resolvable race, an
// election that has not passed, and no plan content yet. `isActive`/`isDemo`
// match the weekly cron's cohort.
//
// "No plan yet" is the absence of BOTH persisted sections rather than the
// absence of the row: a campaign whose generation failed half way has a row
// with one marker set, and it should be picked up too.
//
// "Not passed" is GREATEST of the dates, not COALESCE. The service refuses
// only when EVERY stored date has passed (`electionHasPassed`), so a returning
// candidate carrying last cycle's general date alongside an upcoming primary
// is still generable — and COALESCE, which prefers the general, would read
// that campaign as expired and quietly leave it out of the cohort. GREATEST
// ignores a NULL branch, so a campaign with only one date still works.
export const selectCandidates = (
  prisma: PrismaService,
): Promise<CandidateRow[]> =>
  prisma.$queryRaw<CandidateRow[]>`
    SELECT
      c.id,
      c.organization_slug AS "organizationSlug",
      u.email,
      -- The date that keeps the campaign live, so the dry run does not print
      -- a stale general for a candidate whose primary is still ahead.
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
    ORDER BY c.id ASC
  `

// ScheduleModule is deliberately absent, so the @Cron decorators in
// CampaignsModule are inert here, and QueueConsumerModule is not imported, so
// this process never drains the real SQS queue. CampaignsModule is needed
// because CampaignStrategyService injects CampaignTrackerTasksService, which
// that (@Global) module provides.
@Module({
  imports: [
    loggerModule,
    PrismaModule,
    CampaignsModule,
    CampaignStrategyModule,
  ],
})
class BackfillModule {}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const app = await NestFactory.createApplicationContext(BackfillModule, {
    logger: ['error', 'warn'],
  })

  const outcomes = { dispatched: 0, skipped: 0, failed: 0 }

  try {
    const prisma = app.get(PrismaService)
    const strategy = app.get(CampaignStrategyService)

    const all = await selectCandidates(prisma)
    // Test campaigns short-circuit inside the endpoint, so dispatching for them
    // would be a no-op that still counts as work. Filtered here rather than in
    // SQL because the rule is an email predicate owned by users.util.
    const eligible = all.filter((row) => !isTestCampaign({ user: row }))
    const batch = args.limit ? eligible.slice(0, args.limit) : eligible

    console.log(
      `${eligible.length} campaigns with no plan ` +
        `(${all.length - eligible.length} test campaigns skipped)`,
    )
    console.log(
      `Processing ${batch.length}` +
        (args.apply
          ? ''
          : ` — DRY RUN, nothing dispatched. Approx $${
              batch.length * APPROX_COST_PER_CAMPAIGN_USD
            } to apply.`),
    )

    if (!args.apply) {
      for (const row of batch.slice(0, 20)) {
        console.log(`  campaign ${row.id} (election ${row.electionDate})`)
      }
      if (batch.length > 20) console.log(`  ... and ${batch.length - 20} more`)
      console.log('\nRe-run with --apply once the list above looks right.')
      return
    }

    for (const row of batch) {
      // Re-read with the user include the endpoint requires. A campaign that
      // vanished between the scan and here is a skip, not a failure.
      const campaign = await prisma.campaign.findUnique({
        where: { id: row.id },
        include: { user: true },
      })
      if (!campaign) {
        outcomes.skipped += 1
        continue
      }

      try {
        const res = await strategy.getOrGenerateStrategicLandscape(campaign)
        if (res.status === 'failed') {
          outcomes.failed += 1
          console.error(`  campaign ${row.id}: failed (${res.reason})`)
          continue
        }
        outcomes.dispatched += 1
        console.log(`  campaign ${row.id}: ${res.status}`)
      } catch (err) {
        // One campaign's bad data (no race, stale election) must not stop the
        // run. The endpoint throws 400s for exactly those cases.
        outcomes.failed += 1
        console.error(`  campaign ${row.id}: threw`, err)
      }
    }

    console.log(
      `\nDispatched ${outcomes.dispatched}, skipped ${outcomes.skipped}, ` +
        `failed ${outcomes.failed}`,
    )
    if (outcomes.failed > 0) process.exitCode = 1
  } finally {
    await app.close()
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
