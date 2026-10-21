import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { Pool } from 'pg'
import { z } from 'zod'

const DATABRICKS_HOST = 'dbc-3d8ca484-79f3.cloud.databricks.com'
const MAX_IDS_PER_POLL = 500
const BENCH_SLUG_PREFIX = 'poc-bench-'
const IDENTIFIER_RE = /^[A-Za-z0-9_`.-]+$/
const MODES = ['insert', 'update', 'delete', 'check', 'schema-drill'] as const
const TABLES = ['replication_probe', 'campaign'] as const

type Mode = (typeof MODES)[number]
type Table = (typeof TABLES)[number]

type Op = {
  id: string
  writtenUs: bigint
  committedAt: number
  opMs: number
  seenAt?: number
}

type TableChecksum = {
  count: string
  checksum: string
  payloadChars: string | null
}

const statementSchema = z.object({
  status: z.object({
    state: z.string(),
    error: z.object({ message: z.string().optional() }).optional(),
  }),
  result: z
    .object({ data_array: z.array(z.array(z.string().nullable())).optional() })
    .optional(),
})

const sourceUs = '(extract(epoch from updated_at) * 1000000)::bigint'
const targetUs = 'unix_micros(CAST(updated_at AS TIMESTAMP))'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const positive = (name: string, value: string | undefined): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive number, got ${value}`)
  }
  return parsed
}

const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p: number) =>
    sorted.length === 0
      ? null
      : (sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? null)
  return {
    n: sorted.length,
    p50: at(50),
    p95: at(95),
    max: sorted.at(-1) ?? null,
  }
}

const main = async (): Promise<void> => {
  const { values: args } = parseArgs({
    options: {
      mode: { type: 'string', default: 'insert' },
      table: { type: 'string', default: 'replication_probe' },
      target: { type: 'string' },
      'target-table': { type: 'string' },
      count: { type: 'string', default: '20' },
      soak: { type: 'boolean', default: false },
      rate: { type: 'string', default: '1' },
      minutes: { type: 'string', default: '10' },
      rows: { type: 'string', default: '20' },
      'payload-kb': { type: 'string', default: '8' },
      'poll-ms': { type: 'string', default: '250' },
      'timeout-s': { type: 'string', default: '900' },
      check: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  })

  const mode = args.mode as Mode
  if (!MODES.includes(mode)) {
    throw new Error(`--mode must be one of ${MODES.join(', ')}`)
  }
  const table = args.table as Table
  if (!TABLES.includes(table)) {
    throw new Error(`--table must be one of ${TABLES.join(', ')}`)
  }
  if (mode === 'schema-drill' && table !== 'replication_probe') {
    throw new Error('--mode schema-drill only runs on replication_probe')
  }
  const count = positive('count', args.count)
  const rate = positive('rate', args.rate)
  const minutes = positive('minutes', args.minutes)
  const rowsToUpdate = positive('rows', args.rows)
  const payloadChars = Math.round(
    positive('payload-kb', args['payload-kb']) * 1024,
  )
  const pollMs = positive('poll-ms', args['poll-ms'])
  const timeoutMs = positive('timeout-s', args['timeout-s']) * 1000
  const dryRun = args['dry-run']
  const runId = randomUUID()

  const connectionString = process.env.POC_REPLICATION_DATABASE_URL
  if (!connectionString) throw new Error('POC_REPLICATION_DATABASE_URL not set')

  const targetTable = args['target-table'] ?? table
  if (!dryRun && !args.target) {
    throw new Error('--target <catalog.schema> is required unless --dry-run')
  }
  for (const part of [args.target, targetTable]) {
    if (part && !IDENTIFIER_RE.test(part)) {
      throw new Error(`Not a plain Databricks identifier: ${part}`)
    }
  }
  const target = args.target ? `${args.target}.${targetTable}` : null

  const warehouseId = process.env.PEOPLE_DATABRICKS_WAREHOUSE_ID
  const apiKey = process.env.PEOPLE_DATABRICKS_API_KEY
  if (!dryRun && (!warehouseId || !apiKey)) {
    throw new Error(
      'PEOPLE_DATABRICKS_WAREHOUSE_ID and PEOPLE_DATABRICKS_API_KEY must be set unless --dry-run',
    )
  }

  const dbx = async (
    statement: string,
  ): Promise<Array<Array<string | null>>> => {
    const response = await fetch(
      `https://${DATABRICKS_HOST}/api/2.0/sql/statements`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          warehouse_id: warehouseId,
          statement,
          format: 'JSON_ARRAY',
          disposition: 'INLINE',
          wait_timeout: '30s',
          on_wait_timeout: 'CANCEL',
        }),
      },
    )
    if (!response.ok) {
      throw new Error(
        `Databricks HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`,
      )
    }
    const body = statementSchema.parse(await response.json())
    if (body.status.state !== 'SUCCEEDED') {
      throw new Error(
        `Databricks ${body.status.state}: ${body.status.error?.message ?? ''}`,
      )
    }
    return body.result?.data_array ?? []
  }

  const pool = new Pool({ connectionString, max: 8 })
  const startedAt = Date.now()
  const pollRtts: number[] = []
  let pollFailures = 0

  const payload = () =>
    randomBytes(Math.ceil((payloadChars * 3) / 4))
      .toString('base64')
      .slice(0, payloadChars)

  const targetVersions = async (
    ids: string[],
  ): Promise<Map<string, bigint>> => {
    const rows = await dbx(
      `SELECT CAST(id AS STRING), CAST(${targetUs} AS STRING) FROM ${target}` +
        ` WHERE id IN (${ids.join(', ')})`,
    )
    return new Map(
      rows.flatMap(([id, us]) =>
        id ? [[id, BigInt(us ?? '0')] as const] : [],
      ),
    )
  }

  const sourceSide = async (): Promise<TableChecksum> => {
    const { rows } = await pool.query<TableChecksum>(
      `SELECT count(*)::text AS count,` +
        ` md5(coalesce(string_agg(id::text || ':' || ${sourceUs}::text, ','` +
        ` ORDER BY id), '')) AS checksum,` +
        (table === 'replication_probe'
          ? ' coalesce(sum(length(payload)), 0)::text'
          : ' NULL::text') +
        ` AS "payloadChars" FROM ${table}`,
    )
    const row = rows[0]
    if (!row) throw new Error('source checksum returned no row')
    return row
  }

  const targetSide = async (): Promise<TableChecksum> => {
    const [row] = await dbx(
      `SELECT CAST(count(*) AS STRING),` +
        ` md5(array_join(transform(array_sort(collect_list(named_struct(` +
        `'id', CAST(id AS BIGINT), 'us', ${targetUs}))),` +
        ` x -> concat(CAST(x.id AS STRING), ':', CAST(x.us AS STRING))), ',')),` +
        (table === 'replication_probe'
          ? ' CAST(coalesce(sum(length(payload)), 0) AS STRING)'
          : ' CAST(NULL AS STRING)') +
        ` FROM ${target}`,
    )
    return {
      count: row?.[0] ?? '',
      checksum: row?.[1] ?? '',
      payloadChars: row?.[2] ?? null,
    }
  }

  const runCheck = async () => {
    const checkStartedAt = Date.now()
    let source = await sourceSide()
    if (dryRun)
      return { source, target: null, matched: null, timeToMatchMs: null }
    let last: TableChecksum | null = null
    let checkFailures = 0
    while (Date.now() - checkStartedAt < timeoutMs) {
      try {
        last = await targetSide()
        if (
          last.count === source.count &&
          last.checksum === source.checksum &&
          last.payloadChars === source.payloadChars
        ) {
          return {
            source,
            target: last,
            matched: true,
            timeToMatchMs: Date.now() - checkStartedAt,
            checkFailures,
          }
        }
      } catch (err) {
        checkFailures++
        console.error(`check failed: ${String(err)}`)
      }
      await sleep(Math.max(pollMs, 1000))
      source = await sourceSide()
    }
    return {
      source,
      target: last,
      matched: false,
      timeToMatchMs: null,
      checkFailures,
    }
  }

  const insertOne = async (i: number): Promise<{ id: string; us: string }> => {
    if (table === 'replication_probe') {
      const { rows } = await pool.query<{ id: string; us: string }>(
        'INSERT INTO replication_probe (payload, doc) VALUES ($1, $2::jsonb)' +
          ` RETURNING id::text AS id, ${sourceUs}::text AS us`,
        [payload(), JSON.stringify({ runId, n: i })],
      )
      if (!rows[0]) throw new Error('insert returned no row')
      return rows[0]
    }
    const slug = `${BENCH_SLUG_PREFIX}${randomUUID()}`
    const { rows } = await pool.query<{ id: string; us: string }>(
      'WITH u AS (INSERT INTO "user" (email, updated_at)' +
        ' VALUES ($1, now()) RETURNING id),' +
        ' o AS (INSERT INTO organization (slug, owner_id)' +
        ' SELECT $2, id FROM u RETURNING slug, owner_id)' +
        ' INSERT INTO campaign (organization_slug, slug, user_id, data, updated_at)' +
        ' SELECT slug, slug, owner_id, $3::jsonb, now() FROM o' +
        ` RETURNING id::text AS id, ${sourceUs}::text AS us`,
      [
        `${slug}@example.invalid`,
        slug,
        JSON.stringify({ pocBench: { runId, n: i }, pocBenchBlob: payload() }),
      ],
    )
    if (!rows[0]) throw new Error('insert returned no row')
    return rows[0]
  }

  const updateOne = async (
    id: string,
    i: number,
  ): Promise<{ id: string; us: string }> => {
    const { rows } = await pool.query<{ id: string; us: string }>(
      table === 'replication_probe'
        ? "UPDATE replication_probe SET doc = jsonb_set(doc, '{n}', to_jsonb($2::int))," +
            ' updated_at = now() WHERE id = $1' +
            ` RETURNING id::text AS id, ${sourceUs}::text AS us`
        : "UPDATE campaign SET data = jsonb_set(data, '{pocBench}', $2::jsonb)," +
            ` updated_at = now() WHERE id = $1 AND slug LIKE '${BENCH_SLUG_PREFIX}%'` +
            ` RETURNING id::text AS id, ${sourceUs}::text AS us`,
      table === 'replication_probe'
        ? [id, i]
        : [id, JSON.stringify({ runId, n: i })],
    )
    if (!rows[0]) throw new Error(`row ${id} not found`)
    return rows[0]
  }

  const deleteOne = async (id: string): Promise<{ id: string; us: string }> => {
    const { rowCount } = await pool.query(
      table === 'replication_probe'
        ? 'DELETE FROM replication_probe WHERE id = $1'
        : 'DELETE FROM "user" WHERE id = (SELECT user_id FROM campaign' +
            ` WHERE id = $1 AND slug LIKE '${BENCH_SLUG_PREFIX}%')`,
      [id],
    )
    if (!rowCount) throw new Error(`row ${id} not found`)
    return { id, us: '0' }
  }

  const existingIds = async (limit: number): Promise<string[]> => {
    const { rows } = await pool.query<{ id: string }>(
      table === 'replication_probe'
        ? 'SELECT id::text AS id FROM replication_probe ORDER BY id LIMIT $1'
        : 'SELECT id::text AS id FROM campaign' +
            ` WHERE slug LIKE '${BENCH_SLUG_PREFIX}%' ORDER BY id LIMIT $1`,
      [limit],
    )
    return rows.map((row) => row.id)
  }

  const runOps = async () => {
    const total = args.soak ? Math.round(rate * minutes * 60) : count
    let ids: string[] = []
    const absentBeforeDelete = new Set<string>()
    if (mode === 'update') {
      ids = await existingIds(rowsToUpdate)
      if (ids.length === 0) {
        throw new Error(`No ${table} rows to update; run --mode insert first`)
      }
    }
    if (mode === 'delete') {
      ids = await existingIds(total)
      if (ids.length < total) {
        throw new Error(
          `Only ${ids.length} ${table} rows to delete, need ${total}; run --mode insert first`,
        )
      }
      if (!dryRun) {
        const present = new Set<string>()
        for (let i = 0; i < ids.length; i += MAX_IDS_PER_POLL) {
          for (const id of (
            await targetVersions(ids.slice(i, i + MAX_IDS_PER_POLL))
          ).keys()) {
            present.add(id)
          }
        }
        for (const id of ids) if (!present.has(id)) absentBeforeDelete.add(id)
        if (absentBeforeDelete.size > 0) {
          console.error(
            `${absentBeforeDelete.size} rows picked for delete are not in the target yet; deleting them anyway but they count as not seen`,
          )
        }
      }
    }

    const ops: Op[] = []
    let opFailures = 0
    let writing = true

    const runOne = async (i: number): Promise<void> => {
      const before = Date.now()
      try {
        const id = ids[i % Math.max(ids.length, 1)] ?? ''
        const result =
          mode === 'insert'
            ? await insertOne(i)
            : mode === 'update'
              ? await updateOne(id, i)
              : await deleteOne(id)
        const committedAt = Date.now()
        ops.push({
          id: result.id,
          writtenUs: BigInt(result.us),
          committedAt,
          opMs: committedAt - before,
        })
      } catch (err) {
        opFailures++
        console.error(`${mode} ${i} failed: ${String(err)}`)
      }
    }

    const isSeen = (op: Op, versions: Map<string, bigint>): boolean => {
      if (mode === 'delete') {
        return !absentBeforeDelete.has(op.id) && !versions.has(op.id)
      }
      const version = versions.get(op.id)
      if (version === undefined) return false
      return mode === 'insert' || version >= op.writtenUs
    }

    const writeAll = async (): Promise<void> => {
      if (!args.soak) {
        for (let i = 0; i < total; i++) await runOne(i)
        return
      }
      const intervalMs = 1000 / rate
      const pending: Array<Promise<void>> = []
      const writeStartedAt = Date.now()
      for (let i = 0; i < total; i++) {
        await sleep(Math.max(0, writeStartedAt + i * intervalMs - Date.now()))
        pending.push(runOne(i))
      }
      await Promise.all(pending)
    }

    const pollUntilDone = async (): Promise<void> => {
      let lastLogAt = 0
      for (;;) {
        const now = Date.now()
        const waiting = ops.filter(
          (op) => !op.seenAt && now - op.committedAt < timeoutMs,
        )
        if (!writing && waiting.length === 0) return
        const tickStartedAt = Date.now()
        if (waiting.length > 0) {
          const batch = waiting.slice(0, MAX_IDS_PER_POLL)
          try {
            const versions = await targetVersions([
              ...new Set(batch.map((op) => op.id)),
            ])
            const seenAt = Date.now()
            pollRtts.push(seenAt - tickStartedAt)
            for (const op of batch) {
              if (isSeen(op, versions)) op.seenAt = seenAt
            }
          } catch (err) {
            pollFailures++
            console.error(`poll failed: ${String(err)}`)
          }
          if (Date.now() - lastLogAt > 2000) {
            lastLogAt = Date.now()
            console.error(
              `t=${((Date.now() - startedAt) / 1000).toFixed(1)}s` +
                ` written=${ops.length} seen=${ops.filter((op) => op.seenAt).length}`,
            )
          }
        }
        await sleep(Math.max(0, pollMs - (Date.now() - tickStartedAt)))
      }
    }

    const poller = dryRun ? Promise.resolve() : pollUntilDone()
    await writeAll()
    writing = false
    await poller

    const seen = ops.filter((op) => op.seenAt !== undefined)
    return {
      requested: total,
      written: ops.length,
      opFailures,
      notInTargetBeforeDelete:
        mode === 'delete' && !dryRun ? absentBeforeDelete.size : null,
      seen: dryRun ? null : seen.length,
      notSeenWithinTimeout: dryRun ? null : ops.length - seen.length,
      pollFailures,
      lagMs: dryRun
        ? null
        : stats(seen.map((op) => (op.seenAt ?? 0) - op.committedAt)),
      pollRttMs: dryRun ? null : stats(pollRtts),
      opMs: stats(ops.map((op) => op.opMs)),
    }
  }

  const runSchemaDrill = async () => {
    const migration = readFileSync(
      join(__dirname, '..', 'sql', '002_replication_probe_add_column.sql'),
      'utf8',
    )
    const [existing] = await existingIds(1)
    await pool.query(migration)
    const appliedAt = Date.now()
    const note = `drill-${runId}`
    const { rows: inserted } = await pool.query<{ id: string; us: string }>(
      'INSERT INTO replication_probe (payload, doc, drill_note)' +
        ' VALUES ($1, $2::jsonb, $3)' +
        ` RETURNING id::text AS id, ${sourceUs}::text AS us`,
      [payload(), JSON.stringify({ runId, drill: true }), note],
    )
    const { rows: updated } = existing
      ? await pool.query<{ id: string; us: string }>(
          'UPDATE replication_probe SET drill_note = $2, updated_at = now()' +
            ` WHERE id = $1 RETURNING id::text AS id, ${sourceUs}::text AS us`,
          [existing, note],
        )
      : { rows: [] }
    const written = [...inserted, ...updated]
    const ids = written.map((row) => row.id)
    const timeline: {
      rowsVisibleMs: number | null
      columnVisibleMs: number | null
      valuesVisibleMs: number | null
      errors: Array<{ atMs: number; query: string; message: string }>
    } = {
      rowsVisibleMs: null,
      columnVisibleMs: null,
      valuesVisibleMs: null,
      errors: [],
    }
    if (dryRun) return { migration: migration.trim(), ids, timeline: null }

    const seenErrors = new Set<string>()
    const recordError = (query: string, err: unknown) => {
      const message = String(err).slice(0, 400)
      if (seenErrors.has(`${query}:${message}`)) return
      seenErrors.add(`${query}:${message}`)
      timeline.errors.push({ atMs: Date.now() - appliedAt, query, message })
      console.error(`${query} failed: ${message}`)
    }

    while (
      Date.now() - appliedAt < timeoutMs &&
      timeline.valuesVisibleMs === null
    ) {
      const tickStartedAt = Date.now()
      const rowsCurrent = (versions: Map<string, bigint>) =>
        written.every((row) => (versions.get(row.id) ?? -1n) >= BigInt(row.us))
      try {
        const rows = await dbx(
          `SELECT CAST(id AS STRING), CAST(${targetUs} AS STRING),` +
            ` CAST(drill_note AS STRING) FROM ${target}` +
            ` WHERE id IN (${ids.join(', ')})`,
        )
        const seenAt = Date.now() - appliedAt
        timeline.columnVisibleMs ??= seenAt
        const versions = new Map(
          rows.map(([id, us]) => [id ?? '', BigInt(us ?? '0')] as const),
        )
        if (rowsCurrent(versions)) timeline.rowsVisibleMs ??= seenAt
        const notes = new Map(rows.map(([id, , value]) => [id, value]))
        if (ids.every((id) => notes.get(id) === note)) {
          timeline.valuesVisibleMs = seenAt
        }
      } catch (err) {
        recordError('drill_note', err)
        if (timeline.rowsVisibleMs === null) {
          try {
            if (rowsCurrent(await targetVersions(ids))) {
              timeline.rowsVisibleMs = Date.now() - appliedAt
            }
          } catch (rowsErr) {
            recordError('rows', rowsErr)
          }
        }
      }
      await sleep(
        Math.max(0, Math.max(pollMs, 1000) - (Date.now() - tickStartedAt)),
      )
    }
    return { migration: migration.trim(), ids, timeline }
  }

  try {
    const { rows: probe } = await pool.query<{ probe: string | null }>(
      "SELECT to_regclass('replication_probe')::text AS probe",
    )
    if (!probe[0]?.probe) {
      throw new Error(
        'No replication_probe table: POC_REPLICATION_DATABASE_URL must point at the POC database (apply sql/001_replication_probe.sql first)',
      )
    }
    const databricksTimezone = dryRun
      ? null
      : ((await dbx('SELECT current_timezone()'))[0]?.[0] ?? null)
    const result =
      mode === 'check'
        ? { check: await runCheck() }
        : mode === 'schema-drill'
          ? { drill: await runSchemaDrill() }
          : { ...(await runOps()), check: args.check ? await runCheck() : null }
    console.log(
      JSON.stringify(
        {
          mode,
          table,
          soak: args.soak,
          dryRun,
          target,
          databricksTimezone,
          runId,
          ...result,
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

main().catch((err) => {
  console.error('Replication bench failed:', err)
  process.exit(1)
})
