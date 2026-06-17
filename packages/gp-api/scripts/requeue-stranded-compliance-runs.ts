/**
 * Re-queue compliance_setup runs stranded at `pending_website_live` by the
 * ssrfSafeLookup `all:true` bug (verify-live's fetch threw ERR_INVALID_IP_ADDRESS
 * for every real domain, so the agent looped to MAX_RESUME_ATTEMPTS and FAILED
 * even though the site was live).
 *
 * Each stranded candidate has many FAILED rows — the resume loop supersedes each
 * prior row ("Superseded by resumed run"). Only the single terminal row carries
 * `error = "Exceeded max resume attempts (N) at stage: pending_website_live"`.
 * This flips that one row back to AWAITING_RESUME with resumeAttempts=0 and
 * resumeScheduledFor=now; the `sweepResumableRuns` cron (every 5 min) then
 * re-dispatches it with trigger=recovery_resume against the now-fixed endpoint.
 *
 * ONLY RUN AFTER the gp-api fix is deployed to prod AND the compliance_setup
 * instruction.md is republished — otherwise the re-dispatch fails the same way.
 *
 * Idempotent: targets only status=FAILED rows with the terminal error string, so
 * a row already flipped (now AWAITING_RESUME / superseded) won't be re-matched.
 * `--failed-before` is REQUIRED: pass the deploy timestamp so the query can't
 * include runs that failed legitimately AFTER the fix (a site that genuinely
 * never went live re-exhausts 48 attempts and carries the same error string) —
 * re-queuing those would loop them forever.
 *
 * Usage (dry-run by default — prints what it would do, mutates nothing).
 * Pass the actual deploy timestamp; the examples below use a past placeholder
 * because the guard at parseArgs rejects a future cutoff:
 *   npx tsx scripts/requeue-stranded-compliance-runs.ts --failed-before=2026-06-17T00:00:00Z
 *   npx tsx scripts/requeue-stranded-compliance-runs.ts --failed-before=2026-06-17T00:00:00Z --execute
 *
 * Required env vars:
 *   DATABASE_URL — Postgres connection string (point at prod to remediate prod)
 */
import '../dist/configrc'

import {
  PrismaClient,
  Prisma,
  ExperimentRunStatus,
} from '../src/generated/prisma'

const STAGE = 'pending_website_live'
const TERMINAL_ERROR_PREFIX = 'Exceeded max resume attempts'

const parseArgs = () => {
  const args = process.argv.slice(2)
  const execute = args.includes('--execute')
  const before = args.find((a) => a.startsWith('--failed-before='))
  if (!before) {
    throw new Error(
      '--failed-before is required. Pass the deploy timestamp (in the past) ' +
        'so post-fix failures are excluded, e.g. --failed-before=2026-06-17T00:00:00Z',
    )
  }
  const failedBefore = new Date(before.split('=')[1])
  if (Number.isNaN(failedBefore.getTime())) {
    throw new Error(`--failed-before is not a valid date: ${before}`)
  }
  // A future cutoff would re-match runs that exhausted their attempts AFTER the
  // fix (legitimate failures), looping them forever — the exact case the flag
  // exists to prevent. Only a past timestamp can mean "before the fix shipped".
  if (failedBefore.getTime() >= Date.now()) {
    throw new Error(
      `--failed-before must be in the past (got ${failedBefore.toISOString()}). ` +
        'Pass the deploy timestamp, not a future date.',
    )
  }
  return { execute, failedBefore }
}

const main = async () => {
  const { execute, failedBefore } = parseArgs()
  const prisma = new PrismaClient()

  try {
    const stranded = await prisma.experimentRun.findMany({
      where: {
        experimentType: 'compliance_setup',
        status: ExperimentRunStatus.FAILED,
        stage: STAGE,
        error: { startsWith: TERMINAL_ERROR_PREFIX },
        updatedAt: { lt: failedBefore },
      },
      select: {
        runId: true,
        organizationSlug: true,
        params: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: Prisma.SortOrder.asc },
    })

    console.log(
      `Mode: ${execute ? 'EXECUTE' : 'DRY-RUN'} | failed-before: ` +
        `${failedBefore.toISOString()} | matched: ${stranded.length}`,
    )

    // resumeRun() needs params.clerk_user_id to re-dispatch; a row without it
    // would just re-fail with "Cannot resume". Surface those instead of flipping.
    const hasActor = (params: Prisma.JsonValue): boolean =>
      typeof params === 'object' &&
      params !== null &&
      !Array.isArray(params) &&
      typeof params['clerk_user_id'] === 'string'

    const missingActor = stranded.filter((run) => !hasActor(run.params))

    for (const run of stranded) {
      console.log(
        `  ${run.organizationSlug} runId=${run.runId} ` +
          `failedAt=${run.updatedAt.toISOString()}`,
      )
    }
    if (missingActor.length > 0) {
      console.log(
        `\nWARNING: ${missingActor.length} row(s) lack params.clerk_user_id ` +
          `and will be skipped (cannot re-dispatch without an actor):`,
      )
      for (const run of missingActor) console.log(`  ${run.runId}`)
    }

    const toRequeue = stranded.filter((run) => !missingActor.includes(run))

    if (!execute) {
      console.log(
        `\nDry-run: would re-queue ${toRequeue.length} run(s). ` +
          `Re-run with --execute to apply.`,
      )
      return
    }

    let requeued = 0
    for (const run of toRequeue) {
      const result = await prisma.experimentRun.updateMany({
        where: { runId: run.runId, status: ExperimentRunStatus.FAILED },
        data: {
          status: ExperimentRunStatus.AWAITING_RESUME,
          resumeAttempts: 0,
          resumeScheduledFor: new Date(),
          error: null,
        },
      })
      requeued += result.count
    }

    console.log(
      `\nRe-queued ${requeued} run(s). The resume sweep re-dispatches`,
    )
    console.log(`them within ~5 minutes (trigger=recovery_resume).`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error('Re-queue failed:', e)
  process.exit(1)
})
