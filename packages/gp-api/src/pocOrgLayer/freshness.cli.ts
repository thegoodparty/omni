/**
 * POC replication freshness benchmark. Inserts synthetic events into the POC
 * Postgres change log, one transaction each, and polls the Databricks log
 * source until each event_id is visible there. Lag is measured from the
 * INSERT returning to the poll that first saw the row returning, so it
 * includes up to one poll round trip (reported as pollRttMs).
 *
 *   npx tsx --env-file=.env src/pocOrgLayer/freshness.cli.ts --count 20
 *   npx tsx --env-file=.env src/pocOrgLayer/freshness.cli.ts --soak --rate 2 --minutes 10
 *   npx tsx --env-file=.env src/pocOrgLayer/freshness.cli.ts --count 5 --dry-run
 *
 * Env: POC_ORG_LAYER_DATABASE_URL (Postgres), POC_ORG_LAYER_LOG_SOURCE (the
 * Databricks table to poll), PEOPLE_DATABRICKS_WAREHOUSE_ID and
 * PEOPLE_DATABRICKS_API_KEY (not needed with --dry-run).
 */
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { Pool } from 'pg'
import { z } from 'zod'
import {
  ORG_LAYER_PG_LOG_TABLE,
  orgLayerLogSource,
} from '../peopleDb/databricks/orgLayer.poc'
import { resolvePeopleDbxConfig } from '../peopleDb/databricks/peopleDbx.config'

const MAX_IDS_PER_POLL = 1000

const statementSchema = z.object({
  status: z.object({
    state: z.string(),
    error: z.object({ message: z.string().optional() }).optional(),
  }),
  result: z
    .object({ data_array: z.array(z.array(z.string().nullable())).optional() })
    .optional(),
})

type BenchEvent = {
  eventId: string
  insertedAt: number
  insertMs: number
  seenAt?: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const percentile = (sorted: number[], p: number): number | null => {
  if (sorted.length === 0) return null
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  )
  return sorted[Math.max(0, index)] ?? null
}

const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.at(-1) ?? null,
  }
}

const main = async (): Promise<void> => {
  const { values: args } = parseArgs({
    options: {
      count: { type: 'string', default: '20' },
      soak: { type: 'boolean', default: false },
      rate: { type: 'string', default: '1' },
      minutes: { type: 'string', default: '10' },
      'poll-ms': { type: 'string', default: '250' },
      'timeout-s': { type: 'string', default: '900' },
      'org-slug': { type: 'string', default: 'poc-freshness-bench' },
      source: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  const count = Number(args.count)
  const rate = Number(args.rate)
  const minutes = Number(args.minutes)
  const pollMs = Number(args['poll-ms'])
  const timeoutMs = Number(args['timeout-s']) * 1000
  const orgSlug = args['org-slug']
  const dryRun = args['dry-run']
  if (args.source) process.env.POC_ORG_LAYER_LOG_SOURCE = args.source
  const source = orgLayerLogSource()

  const connectionString = process.env.POC_ORG_LAYER_DATABASE_URL
  if (!connectionString) throw new Error('POC_ORG_LAYER_DATABASE_URL not set')
  const dbx = dryRun ? null : resolvePeopleDbxConfig()
  if (!dryRun && !dbx?.accessToken) {
    throw new Error(
      'PEOPLE_DATABRICKS_WAREHOUSE_ID and PEOPLE_DATABRICKS_API_KEY must be set',
    )
  }

  const pool = new Pool({ connectionString, max: 4 })
  const events: BenchEvent[] = []
  const pollRtts: number[] = []
  let insertFailures = 0
  let pollFailures = 0
  let inserting = true
  const startedAt = Date.now()

  const insertOne = async (i: number): Promise<void> => {
    const eventId = randomUUID()
    const before = Date.now()
    try {
      await pool.query(
        `INSERT INTO ${ORG_LAYER_PG_LOG_TABLE} (event_id, org_slug, person_id,` +
          ' kind, field, value, source, import_id, actor_user_id, created_at)' +
          " VALUES ($1, $2, $3, 'set', 'FirstName', $4, 'bench', NULL, NULL," +
          ' now())',
        [eventId, orgSlug, randomUUID(), `Bench${i}`],
      )
      const insertedAt = Date.now()
      events.push({ eventId, insertedAt, insertMs: insertedAt - before })
    } catch (err) {
      insertFailures++
      console.error(`insert ${i} failed: ${String(err)}`)
    }
  }

  const insertAll = async (): Promise<void> => {
    if (!args.soak) {
      for (let i = 0; i < count; i++) await insertOne(i)
      return
    }
    const intervalMs = 1000 / rate
    const total = Math.round(rate * minutes * 60)
    const pending: Array<Promise<void>> = []
    for (let i = 0; i < total; i++) {
      const due = startedAt + i * intervalMs
      await sleep(Math.max(0, due - Date.now()))
      pending.push(insertOne(i))
    }
    await Promise.all(pending)
  }

  const pollOnce = async (ids: string[]): Promise<Set<string>> => {
    if (!dbx?.accessToken) throw new Error('Databricks is not configured')
    const response = await fetch(
      `https://${dbx.hostname}/api/2.0/sql/statements`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${dbx.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          warehouse_id: dbx.warehouseId,
          statement:
            `SELECT CAST(event_id AS STRING) FROM ${source}` +
            ` WHERE org_slug = :org_slug AND event_id IN (` +
            ids.map((_, i) => `:e${i}`).join(', ') +
            ')',
          parameters: [
            { name: 'org_slug', value: orgSlug },
            ...ids.map((value, i) => ({ name: `e${i}`, value })),
          ],
          format: 'JSON_ARRAY',
          disposition: 'INLINE',
          wait_timeout: '30s',
          on_wait_timeout: 'CANCEL',
        }),
      },
    )
    if (!response.ok) {
      throw new Error(`Databricks HTTP ${response.status}`)
    }
    const body = statementSchema.parse(await response.json())
    if (body.status.state !== 'SUCCEEDED') {
      throw new Error(
        `Databricks ${body.status.state}: ${body.status.error?.message ?? ''}`,
      )
    }
    return new Set(
      (body.result?.data_array ?? []).flatMap(([id]) =>
        id ? [id.toLowerCase()] : [],
      ),
    )
  }

  const pollUntilDone = async (): Promise<void> => {
    for (;;) {
      const now = Date.now()
      const waiting = events.filter(
        (event) => !event.seenAt && now - event.insertedAt < timeoutMs,
      )
      if (!inserting && waiting.length === 0) return
      const tickStartedAt = Date.now()
      if (waiting.length > 0) {
        const batch = waiting.slice(0, MAX_IDS_PER_POLL)
        try {
          const seen = await pollOnce(batch.map((event) => event.eventId))
          const seenAt = Date.now()
          pollRtts.push(seenAt - tickStartedAt)
          for (const event of batch) {
            if (seen.has(event.eventId)) event.seenAt = seenAt
          }
        } catch (err) {
          pollFailures++
          console.error(`poll failed: ${String(err)}`)
        }
        const seenCount = events.filter((event) => event.seenAt).length
        console.error(
          `t=${((Date.now() - startedAt) / 1000).toFixed(1)}s` +
            ` inserted=${events.length} seen=${seenCount}`,
        )
      }
      await sleep(Math.max(0, pollMs - (Date.now() - tickStartedAt)))
    }
  }

  try {
    const poller = dryRun ? Promise.resolve() : pollUntilDone()
    await insertAll()
    inserting = false
    await poller

    const ids = events.map((event) => event.eventId)
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${ORG_LAYER_PG_LOG_TABLE}` +
        ' WHERE event_id = ANY($1::uuid[])',
      [ids],
    )
    const seen = events.filter((event) => event.seenAt !== undefined)
    console.log(
      JSON.stringify(
        {
          mode: args.soak ? 'soak' : 'burst',
          dryRun,
          source: dryRun ? null : source,
          orgSlug,
          requested: args.soak ? Math.round(rate * minutes * 60) : count,
          inserted: events.length,
          insertedInPostgres: Number(rows[0]?.n ?? 0),
          insertFailures,
          seen: dryRun ? null : seen.length,
          notSeenWithinTimeout: dryRun ? null : events.length - seen.length,
          pollFailures,
          lagMs: dryRun
            ? null
            : stats(
                seen.map((event) => (event.seenAt ?? 0) - event.insertedAt),
              ),
          pollRttMs: dryRun ? null : stats(pollRtts),
          insertMs: stats(events.map((event) => event.insertMs)),
          durationS: Math.round((Date.now() - startedAt) / 1000),
        },
        null,
        2,
      ),
    )
  } finally {
    await pool.end()
  }
}

if (process.argv[1]?.includes('freshness.cli')) {
  main().catch((err) => {
    console.error('Freshness benchmark failed:', err)
    process.exit(1)
  })
}
