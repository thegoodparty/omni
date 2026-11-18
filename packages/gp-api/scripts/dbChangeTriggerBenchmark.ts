import { Client } from 'pg'

// What the capture trigger costs a write. Run against a local database, since
// it writes 2,000 rows:
//   npm run bench:db-change-triggers -w packages/gp-api
// Off: the kill switch is off, so db_change_capture() returns before it
// writes. On: every update captures a row. The difference is what every
// captured write pays, on top of a row insert into db_change.
//
// Each update is its own round trip, so the client-observed numbers are
// mostly round-trip latency and the totals are the reliable comparison. A real
// write here is inside a transaction with the work around it, which is where
// the trigger's cost shows up.

const ROWS = 2_000
const SLUG = 'db-change-trigger-benchmark'

type Timings = { mean: number; p50: number; p99: number; totalMs: number }

const timings = (samples: number[]): Timings => {
  const sorted = [...samples].sort((left, right) => left - right)
  const at = (quantile: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))]!
  const totalMs = samples.reduce((sum, sample) => sum + sample, 0)
  return {
    mean: totalMs / samples.length,
    p50: at(0.5),
    p99: at(0.99),
    totalMs,
  }
}

const fmt = ({ mean, p50, p99, totalMs }: Timings): string =>
  `mean ${mean.toFixed(3)}ms  p50 ${p50.toFixed(3)}ms  p99 ${p99.toFixed(3)}ms  ` +
  `total ${totalMs.toFixed(0)}ms`

const main = async (): Promise<void> => {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('Set DATABASE_URL')
  const client = new Client({ connectionString })
  await client.connect()
  try {
    await client.query(`DELETE FROM campaign WHERE organization_slug = $1`, [
      SLUG,
    ])
    await client.query(`DELETE FROM organization WHERE slug = $1`, [SLUG])
    const { rows: users } = await client.query<{ id: number }>(
      `SELECT id FROM "user" ORDER BY id LIMIT 1`,
    )
    const userId = users[0]?.id
    if (!userId) throw new Error('Needs one user row in the database')
    await client.query(
      `INSERT INTO organization (slug, owner_id) VALUES ($1, $2)`,
      [SLUG, userId],
    )
    const { rows: campaigns } = await client.query<{ id: number }>(
      `INSERT INTO campaign (user_id, slug, organization_slug, updated_at)
       VALUES ($1, $2, $2, now()) RETURNING id`,
      [userId, SLUG],
    )
    const campaignId = campaigns[0]!.id

    const run = async (enabled: boolean): Promise<Timings> => {
      await client.query(
        `UPDATE db_change_config SET enabled = $1 WHERE id = 1`,
        [enabled],
      )
      const samples: number[] = []
      for (let index = 0; index < ROWS; index++) {
        const startedAt = performance.now()
        await client.query(
          `UPDATE campaign SET is_active = $1, updated_at = now() WHERE id = $2`,
          [index % 2 === 0, campaignId],
        )
        samples.push(performance.now() - startedAt)
      }
      return timings(samples)
    }

    const off = await run(false)
    const on = await run(true)
    await client.query(
      `UPDATE db_change_config SET enabled = true WHERE id = 1`,
    )

    const { rows: captured } = await client.query<{ count: string }>(
      `SELECT count(*) FROM db_change WHERE table_name = 'campaign'
        AND new_row->>'id' = $1`,
      [String(campaignId)],
    )

    console.log(`${ROWS} single-row campaign updates, one at a time`)
    console.log(`  capture off: ${fmt(off)}`)
    console.log(`  capture on:  ${fmt(on)}`)
    console.log(
      `  added by capture: mean ${(on.mean - off.mean).toFixed(3)}ms  ` +
        `p50 ${(on.p50 - off.p50).toFixed(3)}ms  ` +
        `p99 ${(on.p99 - off.p99).toFixed(3)}ms`,
    )
    console.log(
      `  added by capture, in total: ${(on.totalMs - off.totalMs).toFixed(0)}ms`,
    )
    console.log(`  db_change rows written: ${captured[0]?.count ?? '0'}`)
  } finally {
    await client.query(`DELETE FROM campaign WHERE organization_slug = $1`, [
      SLUG,
    ])
    await client.query(`DELETE FROM organization WHERE slug = $1`, [SLUG])
    await client.end()
  }
}

void main()
