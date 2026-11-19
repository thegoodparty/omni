/**
 * Converts every unredeemed free-texts offer into outreach credit.
 *
 * Credits replace the free texts offer, so each campaign with
 * `has_free_texts_offer = true` gets `PLAN_PRICING.includedCreditCents` added
 * to `outreach_credit_cents` and the offer flag cleared. A redeemed offer is
 * already spent, so there is nothing to convert.
 *
 * Usage (dry run by default, writes nothing):
 *   npx tsx scripts/convert-free-texts-to-credits.ts
 *   npx tsx scripts/convert-free-texts-to-credits.ts --apply
 *
 * Run it against production only at launch, after new grants have stopped.
 *
 * A campaign with a free-texts send in flight is skipped and listed: that send
 * may still redeem or restore the offer, so converting now could double-grant.
 * Run again once those sends settle.
 */
import 'dotenv/config'
import { PLAN_PRICING } from '@goodparty_org/contracts'
import { PrismaClient } from '../src/generated/prisma'

export type SqlRunner = {
  query<T>(sql: string, params: unknown[]): Promise<T[]>
}

export type OfferCampaign = { id: number; inFlight: boolean }

export type ConversionReport = {
  apply: boolean
  converted: number[]
  skippedInFlight: number[]
}

// The hold states before the send's free-texts redemption is final. A hold in
// `captured` or later has either spent the offer or handed it back already.
const UNSETTLED_HOLD_STATES = `'pending_payment', 'hold_pending', 'authorized', 'capturing'`

const IN_FLIGHT_SQL = `(
  EXISTS (
    SELECT 1 FROM outreach o
    WHERE o."campaignId" = c.id AND o.status = 'pending_payment'
  )
  OR EXISTS (
    SELECT 1 FROM outreach o
    JOIN outreach_p2p_sms s ON s.outreach_id = o.id
    WHERE o."campaignId" = c.id
      AND s.free_texts_applied = true
      AND s.settle_state IN (${UNSETTLED_HOLD_STATES})
  )
)`

export const findOfferCampaigns = (db: SqlRunner): Promise<OfferCampaign[]> =>
  db.query<OfferCampaign>(
    `SELECT c.id, ${IN_FLIGHT_SQL} AS "inFlight"
     FROM campaign c
     WHERE c.has_free_texts_offer = true
     ORDER BY c.id`,
    [],
  )

// One statement per campaign, so the credit and the flag flip commit together.
// The WHERE re-checks the flag and the in-flight state at write time: a re-run,
// or a send that started after the read above, matches nothing and credits
// nothing.
export const convertCampaign = async (
  db: SqlRunner,
  campaignId: number,
): Promise<boolean> => {
  const rows = await db.query<{ id: number }>(
    `UPDATE campaign c
     SET outreach_credit_cents = c.outreach_credit_cents + $1,
         has_free_texts_offer = false
     WHERE c.id = $2
       AND c.has_free_texts_offer = true
       AND NOT ${IN_FLIGHT_SQL}
     RETURNING c.id`,
    [PLAN_PRICING.includedCreditCents, campaignId],
  )
  return rows.length === 1
}

export const run = async (
  db: SqlRunner,
  { apply }: { apply: boolean },
): Promise<ConversionReport> => {
  const campaigns = await findOfferCampaigns(db)
  const skippedInFlight = campaigns.filter((c) => c.inFlight).map((c) => c.id)
  const eligible = campaigns.filter((c) => !c.inFlight).map((c) => c.id)

  if (!apply) {
    return { apply, converted: eligible, skippedInFlight }
  }

  const converted: number[] = []
  for (const id of eligible) {
    if (await convertCampaign(db, id)) {
      converted.push(id)
    } else {
      skippedInFlight.push(id)
    }
  }
  return { apply, converted, skippedInFlight }
}

export const formatReport = (report: ConversionReport): string => {
  const verb = report.apply ? 'Converted' : 'Would convert'
  const lines = [
    `${report.apply ? 'APPLY' : 'DRY RUN (nothing written)'}`,
    `${verb} ${report.converted.length} campaign(s) to ${PLAN_PRICING.includedCreditCents} cents of credit each.`,
    `Skipped ${report.skippedInFlight.length} campaign(s) with a free-texts send in flight.`,
  ]
  if (report.skippedInFlight.length > 0) {
    lines.push(
      `Skipped campaign ids (run again once their sends settle): ${report.skippedInFlight.join(', ')}`,
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
      `convert-free-texts-to-credits failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    process.exit(1)
  })
}
