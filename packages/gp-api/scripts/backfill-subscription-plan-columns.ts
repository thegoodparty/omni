/**
 * Stamps the plan columns on Pro subscribers who subscribed before they
 * existed.
 *
 * Those campaigns have `is_pro = true` and a Stripe subscription but sit on the
 * column defaults (`plan = 'free'`, `plan_pricing_model` null), which is what
 * a subscription bought today no longer writes. This sets `plan = 'pro'` and
 * `plan_pricing_model = 'subscription'` so every plan reader sees them as the
 * paying subscribers they are. Nothing else changes: not `is_pro`, not credit,
 * not `plan_paid_at`, and no Pro transition fires.
 *
 * Usage (dry run by default, writes nothing):
 *   npx tsx scripts/backfill-subscription-plan-columns.ts
 *   npx tsx scripts/backfill-subscription-plan-columns.ts --apply
 *
 * Run it against production before ramping `win_per_campaign_pricing`.
 *
 * A subscriber who also holds a one-time plan is never matched: it has a
 * pricing model already. Those campaigns are listed for a human, since they
 * are paying twice and nothing here refunds or cancels anything.
 */
import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma'

export type SqlRunner = {
  query<T>(sql: string, params: unknown[]): Promise<T[]>
}

export type BackfillReport = {
  apply: boolean
  updated: number[]
  paidTwice: number[]
}

// The WHERE is the idempotency guard: a backfilled row no longer matches.
const UNBACKFILLED_WHERE = `c.is_pro = true
  AND NULLIF(c.details->>'subscriptionId', '') IS NOT NULL
  AND c.plan = 'free'
  AND c.plan_pricing_model IS NULL`

export const findUnbackfilled = async (db: SqlRunner): Promise<number[]> => {
  const rows = await db.query<{ id: number }>(
    `SELECT c.id FROM campaign c WHERE ${UNBACKFILLED_WHERE} ORDER BY c.id`,
    [],
  )
  return rows.map((row) => row.id)
}

export const findPaidTwice = async (db: SqlRunner): Promise<number[]> => {
  const rows = await db.query<{ id: number }>(
    `SELECT c.id FROM campaign c
     WHERE c.is_pro = true
       AND NULLIF(c.details->>'subscriptionId', '') IS NOT NULL
       AND c.plan_pricing_model = 'one_time'
       AND c.plan_ended_at IS NULL
     ORDER BY c.id`,
    [],
  )
  return rows.map((row) => row.id)
}

// One statement per campaign, re-checking the match at write time so a row
// that changed since the read (cancelled, or bought a plan) is left alone.
export const backfillCampaign = async (
  db: SqlRunner,
  campaignId: number,
): Promise<boolean> => {
  const rows = await db.query<{ id: number }>(
    `UPDATE campaign c
     SET plan = 'pro', plan_pricing_model = 'subscription'
     WHERE c.id = $1 AND ${UNBACKFILLED_WHERE}
     RETURNING c.id`,
    [campaignId],
  )
  return rows.length === 1
}

export const run = async (
  db: SqlRunner,
  { apply }: { apply: boolean },
): Promise<BackfillReport> => {
  const matched = await findUnbackfilled(db)
  const paidTwice = await findPaidTwice(db)
  if (!apply) {
    return { apply, updated: matched, paidTwice }
  }
  const updated: number[] = []
  for (const id of matched) {
    if (await backfillCampaign(db, id)) {
      updated.push(id)
    }
  }
  return { apply, updated, paidTwice }
}

export const formatReport = (report: BackfillReport): string => {
  const verb = report.apply ? 'Updated' : 'Would update'
  const lines = [
    report.apply ? 'APPLY' : 'DRY RUN (nothing written)',
    `${verb} ${report.updated.length} subscriber campaign(s) to plan = pro, plan_pricing_model = subscription.`,
  ]
  if (report.updated.length > 0) {
    lines.push(`Campaign ids: ${report.updated.join(', ')}`)
  }
  if (report.paidTwice.length > 0) {
    lines.push(
      `${report.paidTwice.length} campaign(s) hold a subscription and a one-time plan (left untouched, review by hand): ${report.paidTwice.join(', ')}`,
    )
  }
  return lines.join('\n')
}

const main = async (): Promise<void> => {
  const apply = process.argv.includes('--apply')
  const prisma = new PrismaClient()
  try {
    const db: SqlRunner = {
      query: <T>(sql: string, params: unknown[]) =>
        prisma.$queryRawUnsafe<T[]>(sql, ...params),
    }
    process.stdout.write(`${formatReport(await run(db, { apply }))}\n`)
  } finally {
    await prisma.$disconnect()
  }
}

// Only when invoked directly: under vitest this file is imported for its
// exports and must not open a Prisma client.
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `backfill-subscription-plan-columns failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    process.exit(1)
  })
}
