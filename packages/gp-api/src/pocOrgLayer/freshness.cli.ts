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
 * --view-count instead times a person-view count (and a bare scan of the log)
 * for one org against POC_ORG_LAYER_LOG_SOURCE and against --compare-source
 * (default: the Delta log), plus the bare vendor table, so the read overhead
 * of each log source can be compared on the same org and district.
 * --seed-people N first writes the same N synthetic people to Postgres and to
 * the compare source, replacing that org's earlier rows in both.
 *
 *   npx tsx --env-file=.env src/pocOrgLayer/freshness.cli.ts --view-count \
 *     --org-slug poc-view-bench --seed-people 500 --runs 5
 *
 * Env: POC_ORG_LAYER_DATABASE_URL (Postgres), POC_ORG_LAYER_LOG_SOURCE (the
 * Databricks table to poll), PEOPLE_DATABRICKS_WAREHOUSE_ID and
 * PEOPLE_DATABRICKS_API_KEY (not needed with --dry-run).
 */
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { Pool } from 'pg'
import { z } from 'zod'
import { peopleTable } from '../peopleDb/databricks/databricksVoterSql.util'
import {
  ORG_LAYER_LOG_TABLE,
  ORG_LAYER_PG_LOG_TABLE,
  orgLayerLogSource,
  personViewSql,
} from '../peopleDb/databricks/orgLayer.poc'
import { resolvePeopleDbxConfig } from '../peopleDb/databricks/peopleDbx.config'

const MAX_IDS_PER_POLL = 1000
const PG_SEED_BATCH = 1000
const DBX_SEED_BATCH = 300
const IDENT = /^[A-Za-z0-9_]+$/

const statementSchema = z.object({
  status: z.object({
    state: z.string(),
    error: z.object({ message: z.string().optional() }).optional(),
  }),
  result: z
    .object({ data_array: z.array(z.array(z.string().nullable())).optional() })
    .optional(),
})

type StatementParameter = { name: string; value: string }

type SeedEvent = {
  eventId: string
  personId: string
  kind: 'create' | 'set'
  field: string | null
  value: string | null
}

type ViewSample = { ms: number; count?: number; error?: string }

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
      'view-count': { type: 'boolean', default: false },
      'compare-source': { type: 'string', default: ORG_LAYER_LOG_TABLE },
      'seed-people': { type: 'string', default: '0' },
      runs: { type: 'string', default: '5' },
      dataset: { type: 'string', default: 'constituents' },
      state: { type: 'string', default: 'MI' },
      'district-type': { type: 'string', default: 'City' },
      'district-name': { type: 'string', default: 'HOUGHTON CITY' },
      explain: { type: 'boolean', default: false },
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

  const runStatement = async (
    statement: string,
    parameters: StatementParameter[] = [],
  ): Promise<Array<Array<string | null>>> => {
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
          statement,
          parameters,
          format: 'JSON_ARRAY',
          disposition: 'INLINE',
          wait_timeout: '50s',
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
    return body.result?.data_array ?? []
  }

  const pollOnce = async (ids: string[]): Promise<Set<string>> => {
    const rows = await runStatement(
      `SELECT CAST(event_id AS STRING) FROM ${source}` +
        ` WHERE org_slug = :org_slug AND event_id IN (` +
        ids.map((_, i) => `:e${i}`).join(', ') +
        ')',
      [
        { name: 'org_slug', value: orgSlug },
        ...ids.map((value, i) => ({ name: `e${i}`, value })),
      ],
    )
    return new Set(rows.flatMap(([id]) => (id ? [id.toLowerCase()] : [])))
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

  const seedPeople = async (
    people: number,
    compareSource: string,
  ): Promise<void> => {
    if (!orgSlug.startsWith('poc-')) {
      throw new Error(
        '--seed-people only runs for org slugs starting with poc-',
      )
    }
    const createdAt = new Date().toISOString()
    const seed: SeedEvent[] = Array.from({ length: people }).flatMap(
      (_, i): SeedEvent[] => {
        const personId = randomUUID()
        return [
          {
            eventId: randomUUID(),
            personId,
            kind: 'create',
            field: null,
            value: null,
          },
          {
            eventId: randomUUID(),
            personId,
            kind: 'set',
            field: 'FirstName',
            value: 'Viewbench',
          },
          {
            eventId: randomUUID(),
            personId,
            kind: 'set',
            field: 'LastName',
            value: `Person${i}`,
          },
        ]
      },
    )

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `DELETE FROM ${ORG_LAYER_PG_LOG_TABLE} WHERE org_slug = $1`,
        [orgSlug],
      )
      for (let i = 0; i < seed.length; i += PG_SEED_BATCH) {
        const batch = seed.slice(i, i + PG_SEED_BATCH)
        await client.query(
          `INSERT INTO ${ORG_LAYER_PG_LOG_TABLE} (event_id, org_slug, person_id,` +
            ' kind, field, value, source, import_id, actor_user_id, created_at)' +
            ' VALUES ' +
            batch
              .map(
                (_, j) =>
                  `($${j * 5 + 3}, $1, $${j * 5 + 4}, $${j * 5 + 5},` +
                  ` $${j * 5 + 6}, $${j * 5 + 7}, 'bench', NULL, NULL, $2)`,
              )
              .join(', '),
          [
            orgSlug,
            createdAt,
            ...batch.flatMap((e) => [
              e.eventId,
              e.personId,
              e.kind,
              e.field,
              e.value,
            ]),
          ],
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    if (dryRun) return

    await runStatement(
      `DELETE FROM ${compareSource} WHERE org_slug = :org_slug`,
      [{ name: 'org_slug', value: orgSlug }],
    )
    for (let i = 0; i < seed.length; i += DBX_SEED_BATCH) {
      const batch = seed.slice(i, i + DBX_SEED_BATCH)
      const nullable = (name: string, value: string | null) =>
        value === null ? 'CAST(NULL AS STRING)' : `:${name}`
      await runStatement(
        `INSERT INTO ${compareSource} (event_id, org_slug, person_id, kind,` +
          ' field, value, source, import_id, actor_user_id, created_at) VALUES ' +
          batch
            .map(
              (e, j) =>
                `(:e${j}, :org_slug, :p${j}, :k${j}, ${nullable(`f${j}`, e.field)},` +
                ` ${nullable(`v${j}`, e.value)}, 'bench', NULL, NULL,` +
                ' CAST(:created_at AS TIMESTAMP))',
            )
            .join(', '),
        [
          { name: 'org_slug', value: orgSlug },
          { name: 'created_at', value: createdAt },
          ...batch.flatMap((e, j) => [
            { name: `e${j}`, value: e.eventId },
            { name: `p${j}`, value: e.personId },
            { name: `k${j}`, value: e.kind },
            ...(e.field === null ? [] : [{ name: `f${j}`, value: e.field }]),
            ...(e.value === null ? [] : [{ name: `v${j}`, value: e.value }]),
          ]),
        ],
      )
    }
  }

  const runViewCount = async (): Promise<void> => {
    const dataset = args.dataset
    if (dataset !== 'constituents' && dataset !== 'voters') {
      throw new Error(`Bad --dataset ${dataset}`)
    }
    const districtType = args['district-type']
    if (!IDENT.test(districtType)) {
      throw new Error(`Bad --district-type ${districtType}`)
    }
    const people = Number(args['seed-people'])
    const runs = Number(args.runs)
    process.env.POC_ORG_LAYER_LOG_SOURCE = args['compare-source']
    const compareSource = orgLayerLogSource()
    process.env.POC_ORG_LAYER_LOG_SOURCE = source
    const baseTable = peopleTable(dataset)
    const scope = {
      state: args.state,
      districtName: args['district-name'],
    }

    if (people > 0) await seedPeople(people, compareSource)
    if (dryRun) {
      console.log(
        JSON.stringify(
          { mode: 'view-count', dryRun, orgSlug, seededPeople: people },
          null,
          2,
        ),
      )
      return
    }

    const viewSql = (logSource: string): string => {
      process.env.POC_ORG_LAYER_LOG_SOURCE = logSource
      return personViewSql({
        baseTable,
        orgSlug,
        state: scope.state,
        districtType,
        districtName: scope.districtName,
      })
    }
    const scopeParams: StatementParameter[] = [
      { name: 'state', value: scope.state },
      { name: 'district_name', value: scope.districtName },
    ]
    const orgParams: StatementParameter[] = [
      { name: 'org_slug', value: orgSlug },
    ]
    const variants = [
      {
        name: 'baseTable',
        sql: `SELECT count(*) FROM ${baseTable} WHERE State = :state AND ${districtType} = :district_name`,
        params: scopeParams,
      },
      ...[...new Set([source, compareSource])].flatMap((logSource) => [
        {
          name: `personView:${logSource}`,
          sql: `SELECT count(*) FROM ${viewSql(logSource)} v WHERE 1 = 1`,
          params: [],
        },
        {
          name: `logScan:${logSource}`,
          sql: `SELECT count(*) FROM ${logSource} WHERE org_slug = :org_slug`,
          params: orgParams,
        },
      ]),
    ]

    if (args.explain) {
      const plan = await runStatement(
        `EXPLAIN FORMATTED SELECT count(*) FROM ${viewSql(source)} v`,
      )
      const lines = (plan[0]?.[0] ?? '').split('\n')
      const pushed = lines.filter((line) =>
        /pushed|external|jdbc|query:|org_contact_event/i.test(line),
      )
      console.error(
        `EXPLAIN FORMATTED person view over ${source} (matching lines):\n` +
          (pushed.length > 0 ? pushed : lines.slice(0, 80)).join('\n'),
      )
    }

    const samples: Record<string, ViewSample[]> = Object.fromEntries(
      variants.map((variant) => [variant.name, []]),
    )
    for (let run = 0; run < runs; run++) {
      for (const variant of variants) {
        const nonce = randomUUID()
        const before = Date.now()
        try {
          const rows = await runStatement(
            `${variant.sql} AND '${nonce}' IS NOT NULL`,
            variant.params,
          )
          samples[variant.name]?.push({
            ms: Date.now() - before,
            count: Number(rows[0]?.[0]),
          })
        } catch (err) {
          samples[variant.name]?.push({
            ms: Date.now() - before,
            error: String(err),
          })
        }
        console.error(
          `run=${run} ${variant.name} ${JSON.stringify(samples[variant.name]?.at(-1))}`,
        )
      }
    }

    console.log(
      JSON.stringify(
        {
          mode: 'view-count',
          orgSlug,
          source,
          compareSource,
          baseTable,
          scope: { ...scope, districtType },
          seededPeople: people,
          runs,
          results: Object.fromEntries(
            Object.entries(samples).map(([name, list]) => {
              const ok = list.filter((sample) => sample.error === undefined)
              return [
                name,
                {
                  ok: ok.length,
                  failures: list.length - ok.length,
                  counts: [...new Set(ok.map((sample) => sample.count))],
                  ms: stats(ok.map((sample) => sample.ms)),
                  failureMs: stats(
                    list
                      .filter((sample) => sample.error !== undefined)
                      .map((sample) => sample.ms),
                  ),
                  firstError:
                    list.find((sample) => sample.error)?.error ?? null,
                },
              ]
            }),
          ),
        },
        null,
        2,
      ),
    )
  }

  if (args['view-count']) {
    try {
      await runViewCount()
    } finally {
      await pool.end()
    }
    return
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
