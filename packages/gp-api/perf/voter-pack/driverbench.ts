// Which driver, on the identical statement, for the door-knocking pack scan.
//
// The production trace (2026-08-26, Collin County) attributes 9.5s of a 23.3s
// request to Prisma's marshalling — Rust row conversion, the engine's JSON
// serialization, and JS-side JSON.parse plus object assembly — against 10.6s
// of actual Postgres FETCH. This measures the same split locally so the
// Prisma:pg RATIO can be carried back; absolute times here mean nothing (18
// cores against production's 1 vCPU Fargate task).
//
// Imports the production PackEncoder and SQL builders so the encode work and
// the statement text are identical to what the service runs.
//
// Throwaway measurement code — deliberately not part of the build.

import { PrismaClient, Prisma } from '../../src/generated/people-prisma'
import {
  PackEncoder,
  PackRow,
} from '../../src/peopleDb/utils/packEncoder.utils'
import { buildHouseholdKeySql } from '../../src/peopleDb/utils/buildHouseholdKeySql.util'
import pg from 'pg'
import Cursor from 'pg-cursor'
import { PerformanceObserver } from 'node:perf_hooks'

const URL =
  process.env.PGURL ?? 'postgres://postgres:pw@localhost:5599/peopledb'
const FETCH_SIZE = Number(process.env.FETCH_SIZE ?? 50_000)
const DISTRICT = 'tx-collin-county'

const NUMERIC_TEXT = '^-?[0-9]+(\\.[0-9]+)?$'

const projection = (householdKey: string) => `
  SELECT v."id",
    v."Residence_Addresses_Latitude"::float8 AS "lat",
    v."Residence_Addresses_Longitude"::float8 AS "lng",
    ${householdKey} AS "hhKey",
    v."Parties_Description",
    v."Age_Int",
    v."Gender",
    v."Voter_Status",
    v."Marital_Status",
    v."Veteran_Status",
    v."Presence_Of_Children",
    v."Homeowner_Probability_Model",
    v."Business_Owner",
    v."Education_Of_Person",
    v."Estimated_Income_Amount_Int",
    v."Language_Code",
    v."EthnicGroups_EthnicGroup1Desc",
    (v."StateVoterID" IS NOT NULL) AS "registered",
    (v."VoterTelephones_CellPhoneFormatted" IS NOT NULL) AS "hasCellPhone",
    (v."VoterTelephones_LandlineFormatted" IS NOT NULL) AS "hasLandline"
  FROM green."Voter" v
  JOIN green."DistrictVoter" dv ON v."State" = dv."State" AND v."id" = dv."voter_id"
  WHERE v."State" = 'TX'
    AND dv."district_id" = '${DISTRICT}'
    AND v."Residence_Addresses_LatLongAccuracy" = 'GeoMatchRooftop'
    AND v."Residence_Addresses_Latitude" ~ '${NUMERIC_TEXT}'
    AND v."Residence_Addresses_Longitude" ~ '${NUMERIC_TEXT}'`

const HOUSEHOLD_KEY = (() => {
  const sql = buildHouseholdKeySql('v')
  // Rebuild the literal text: buildHouseholdKeySql emits no bind params.
  return sql.strings.join('')
})()

const PACK_SQL = projection(HOUSEHOLD_KEY)

type Phase = { db: number; drain: number; encode: number }

// This machine is shared with other agents and has run at load average >100
// throughout. Wall clock is therefore worthless — the same variant measured
// 1,279 ms and 5,641 ms an hour apart. CPU time consumed is what survives
// contention, and it is also the quantity that actually binds in production:
// the gp-api task is `cpu: '1024'`, one vCPU, and half the pack request is
// that vCPU marshalling rows.
const cpuMs = (): number => {
  const u = process.cpuUsage()
  return (u.user + u.system) / 1000
}

const now = () => Number(process.hrtime.bigint()) / 1e6

// The production trace shows two ~1.7s stalls inside the Prisma client's JS,
// on fetches whose engine time was ordinary — the signature of a major GC on a
// 50,000-row-object cohort. Count them here so batch size can be tested
// against them directly.
const gcPauses: number[] = []
let gcTotal = 0
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    gcPauses.push(entry.duration)
    gcTotal += entry.duration
  }
}).observe({ entryTypes: ['gc'] })

// ---------------------------------------------------------------- Prisma ---
const prismaScan = async (
  client: PrismaClient,
  encode: boolean,
): Promise<{ rows: number; ms: number; cpu: number; phases: Phase }> => {
  const encoder = new PackEncoder(new Map())
  const phases: Phase = { db: 0, drain: 0, encode: 0 }
  let rows = 0
  const start = now()
  const cpuStart = cpuMs()
  await client.$transaction(
    async (tx) => {
      await tx.$executeRaw(
        Prisma.raw(`SET LOCAL statement_timeout = '45000ms'`),
      )
      await tx.$executeRaw(Prisma.raw('SET LOCAL cursor_tuple_fraction = 1'))
      await tx.$executeRaw(
        Prisma.raw(`DECLARE bench_cursor NO SCROLL CURSOR FOR ${PACK_SQL}`),
      )
      for (;;) {
        const t0 = now()
        const batch = await tx.$queryRaw<PackRow[]>(
          Prisma.raw(`FETCH FORWARD ${FETCH_SIZE} FROM bench_cursor`),
        )
        const t1 = now()
        phases.db += t1 - t0
        rows += batch.length
        if (encode) for (const row of batch) encoder.add(row)
        phases.encode += now() - t1
        if (batch.length < FETCH_SIZE) return
      }
    },
    { timeout: 120_000, maxWait: 10_000 },
  )
  const ms = now() - start
  const cpu = cpuMs() - cpuStart
  if (encode) encoder.toBuffer(new Date().toISOString())
  return { rows, ms, cpu, phases }
}

// ------------------------------------------------------------------- pg ----
const pgScan = async (
  rowMode: 'object' | 'array',
  encode: boolean,
): Promise<{
  rows: number
  ms: number
  cpu: number
  phases: Phase
  bytes: number
}> => {
  const client = new pg.Client({ connectionString: URL })
  await client.connect()
  const encoder = new PackEncoder(new Map())
  const phases: Phase = { db: 0, drain: 0, encode: 0 }
  let rows = 0
  const start = now()
  const cpuStart = cpuMs()
  await client.query(`SET statement_timeout = '45000ms'`)
  await client.query('SET cursor_tuple_fraction = 1')
  await client.query('BEGIN')
  const cursor = client.query(
    new Cursor(
      PACK_SQL,
      undefined,
      rowMode === 'array' ? { rowMode: 'array' } : undefined,
    ),
  )
  // Column order for the array path, so the encoder sees the same shape.
  const KEYS: Array<keyof PackRow> = [
    'id',
    'lat',
    'lng',
    'hhKey',
    'Parties_Description',
    'Age_Int',
    'Gender',
    'Voter_Status',
    'Marital_Status',
    'Veteran_Status',
    'Presence_Of_Children',
    'Homeowner_Probability_Model',
    'Business_Owner',
    'Education_Of_Person',
    'Estimated_Income_Amount_Int',
    'Language_Code',
    'EthnicGroups_EthnicGroup1Desc',
    'registered',
    'hasCellPhone',
    'hasLandline',
  ]
  for (;;) {
    const t0 = now()
    const batch: unknown[] = await new Promise<unknown[]>((resolve, reject) => {
      cursor.read(FETCH_SIZE, (err, result) =>
        err ? reject(err) : resolve(result as unknown[]),
      )
    })
    const t1 = now()
    phases.db += t1 - t0
    rows += batch.length
    if (encode) {
      // pg-cursor is untyped at this boundary by construction: the whole point
      // of the array variant is that the driver never builds a row model, so
      // the shape is only known from KEYS and the SELECT's column order.
      if (rowMode === 'array') {
        /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
        for (const tuple of batch as unknown[][]) {
          const row: Record<string, unknown> = {}
          for (let i = 0; i < KEYS.length; i++) {
            const key = KEYS[i]
            if (key !== undefined) row[key] = tuple[i]
          }
          encoder.add(row as unknown as PackRow)
        }
      } else {
        for (const row of batch as PackRow[]) encoder.add(row)
        /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
      }
    }
    phases.encode += now() - t1
    if (batch.length < FETCH_SIZE) break
  }
  await client.query('COMMIT')
  const ms = now() - start
  const cpu = cpuMs() - cpuStart
  if (encode) encoder.toBuffer(new Date().toISOString())
  await client.end()
  return { rows, ms, cpu, phases, bytes: 0 }
}

// ------------------------------------------------ COPY ... TO STDOUT -------
// No driver row model at all: Postgres writes its text COPY format, and the
// fields are cut out of the chunk buffers and handed straight to the encoder.
// This is the floor — it removes the Rust engine, the engine's JSON
// serialization, the JSON.parse, and the per-row object entirely.
const copyScan = async (
  encode: boolean,
): Promise<{
  rows: number
  ms: number
  cpu: number
  phases: Phase
  bytes: number
}> => {
  const { from: _from, to: copyTo } = await import('pg-copy-streams')
  void _from
  const client = new pg.Client({ connectionString: URL })
  await client.connect()
  const encoder = new PackEncoder(new Map())
  const phases: Phase = { db: 0, drain: 0, encode: 0 }
  let rows = 0
  let bytes = 0
  const start = now()
  const cpuStart = cpuMs()
  const stream = client.query(
    copyTo(`COPY (${PACK_SQL}) TO STDOUT (FORMAT text)`),
  )
  // Fields arrive tab-separated, rows newline-terminated, \N for null. The
  // pack's own columns contain no tabs, newlines or backslashes (the household
  // key is UPPER/TRIM'd address text), so a split is sufficient here; a real
  // implementation would still need the escape cases.
  let tail = ''
  // COPY text gives every field as a string or the \N sentinel, and
  // noUncheckedIndexedAccess makes a missing column `undefined`. Both collapse
  // to null here so the encoder sees exactly the shape a driver would hand it.
  const txt = (v: string | undefined): string | null =>
    v === undefined || v === '\\N' ? null : v
  const num = (v: string | undefined): number | null => {
    const s = txt(v)
    return s === null ? null : Number(s)
  }
  const req = (v: string | undefined): string => {
    if (v === undefined) throw new Error('COPY row is missing a column')
    return v
  }
  const handleLine = (line: string) => {
    if (line.length === 0) return
    const f = line.split('\t')
    rows++
    if (!encode) return
    encoder.add({
      id: req(f[0]),
      lat: Number(req(f[1])),
      lng: Number(req(f[2])),
      hhKey: req(f[3]),
      Parties_Description: txt(f[4]),
      Age_Int: num(f[5]),
      Gender: txt(f[6]),
      Voter_Status: txt(f[7]),
      Marital_Status: txt(f[8]),
      Veteran_Status: txt(f[9]),
      Presence_Of_Children: txt(f[10]),
      Homeowner_Probability_Model: txt(f[11]),
      Business_Owner: txt(f[12]),
      Education_Of_Person: txt(f[13]),
      Estimated_Income_Amount_Int: num(f[14]),
      Language_Code: txt(f[15]),
      EthnicGroups_EthnicGroup1Desc: txt(f[16]),
      registered: f[17] === 't',
      hasCellPhone: f[18] === 't',
      hasLandline: f[19] === 't',
    })
  }
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength
      const text = tail + chunk.toString('utf8')
      let from = 0
      for (;;) {
        const nl = text.indexOf('\n', from)
        if (nl === -1) break
        handleLine(text.slice(from, nl))
        from = nl + 1
      }
      tail = text.slice(from)
    })
    stream.on('end', () => {
      handleLine(tail)
      resolve()
    })
    stream.on('error', reject)
  })
  const ms = now() - start
  const cpu = cpuMs() - cpuStart
  phases.db = ms
  if (encode) encoder.toBuffer(new Date().toISOString())
  await client.end()
  return { rows, ms, cpu, phases, bytes }
}

// -------------------------------------------- server-side cost ablations ---
type ExplainJsonRow = { 'QUERY PLAN': Array<Record<string, number>> }
type ExplainTextRow = { 'QUERY PLAN': string }

const serverSide = async () => {
  const client = new pg.Client({ connectionString: URL })
  await client.connect()
  await client.query('SET cursor_tuple_fraction = 1')
  const variants: Array<[string, string]> = [
    ['full production projection', PACK_SQL],
    ["minus the household key ('' AS hhKey)", projection(`''`)],
    [
      'minus the two lat/lng regex predicates',
      PACK_SQL.replace(
        new RegExp(
          `\\s+AND v\\."Residence_Addresses_Lat[a-z]+" ~ '[^']+'`,
          'g',
        ),
        '',
      ),
    ],
    [
      'minus the 16 raw text columns (id/lat/lng/hhKey only)',
      `SELECT v."id", v."Residence_Addresses_Latitude"::float8 AS "lat",
         v."Residence_Addresses_Longitude"::float8 AS "lng",
         ${HOUSEHOLD_KEY} AS "hhKey"
       FROM green."Voter" v
       JOIN green."DistrictVoter" dv ON v."State" = dv."State" AND v."id" = dv."voter_id"
       WHERE v."State" = 'TX' AND dv."district_id" = '${DISTRICT}'
         AND v."Residence_Addresses_LatLongAccuracy" = 'GeoMatchRooftop'
         AND v."Residence_Addresses_Latitude" ~ '${NUMERIC_TEXT}'
         AND v."Residence_Addresses_Longitude" ~ '${NUMERIC_TEXT}'`,
    ],
    [
      'id only (scan + join + filter floor)',
      `SELECT v."id" FROM green."Voter" v
       JOIN green."DistrictVoter" dv ON v."State" = dv."State" AND v."id" = dv."voter_id"
       WHERE v."State" = 'TX' AND dv."district_id" = '${DISTRICT}'
         AND v."Residence_Addresses_LatLongAccuracy" = 'GeoMatchRooftop'
         AND v."Residence_Addresses_Latitude" ~ '${NUMERIC_TEXT}'
         AND v."Residence_Addresses_Longitude" ~ '${NUMERIC_TEXT}'`,
    ],
  ]
  console.log(
    '\nServer-side execution (EXPLAIN ANALYZE, median of 5, discards output):',
  )
  for (const [label, sql] of variants) {
    const times: number[] = []
    let buffers = ''
    for (let i = 0; i < 5; i++) {
      // FORMAT JSON makes the single column an array of plan objects, so the
      // generic says so rather than asserting it back afterwards.
      const { rows } = await client.query<ExplainJsonRow>(
        `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON) ${sql}`,
      )
      const plan = rows[0]?.['QUERY PLAN'][0]
      if (!plan) throw new Error(`EXPLAIN returned no plan for ${label}`)
      times.push(plan['Execution Time'] ?? 0)
      if (i === 0) {
        buffers =
          JSON.stringify(plan).match(/"Shared Hit Blocks":\s*\d+/)?.[0] ?? ''
      }
    }
    times.sort((a, b) => a - b)
    const median = times[Math.floor(times.length / 2)] ?? 0
    console.log(
      `  ${label.padEnd(52)} ${median.toFixed(0).padStart(7)} ms  ${buffers}`,
    )
  }
  // The plan itself, once.
  const { rows } = await client.query<ExplainTextRow>(
    `EXPLAIN (ANALYZE, BUFFERS) ${PACK_SQL}`,
  )
  console.log('\nPlan:')
  for (const r of rows) console.log('  ' + r['QUERY PLAN'])
  // Wire volume, as COPY sees it.
  await client.end()
}

const report = (
  label: string,
  r: { rows: number; ms: number; cpu: number; phases: Phase; bytes?: number },
) => {
  console.log(
    `${label.padEnd(46)} ${r.cpu.toFixed(0).padStart(6)} ms CPU  ` +
      `${((r.cpu * 1000) / r.rows).toFixed(2).padStart(6)} us/row  ` +
      `(wall ${r.ms.toFixed(0)} ms, ${r.rows.toLocaleString()} rows` +
      `${r.bytes ? `, ${(r.bytes / 1e6).toFixed(1)} MB wire` : ''})`,
  )
}

// One variant per process: the encoder retains the whole pack, so heap state
// from a previous variant lands on the next one as GC and makes the numbers
// meaningless (the first pass at this had "no encoder" measuring SLOWER than
// "with encoder").
const VARIANTS: Record<
  string,
  {
    label: string
    run: () => Promise<{ rows: number; ms: number; cpu: number; phases: Phase }>
  }
> = {
  a: {
    label: 'A  Prisma $queryRaw + encoder (today)',
    run: async () => {
      const prisma = new PrismaClient({
        datasources: { peopleDb: { url: URL } },
      })
      await prisma.$connect()
      const out = await prismaScan(prisma, true)
      await prisma.$disconnect()
      return out
    },
  },
  'a-': {
    label: 'A- Prisma $queryRaw, rows discarded',
    run: async () => {
      const prisma = new PrismaClient({
        datasources: { peopleDb: { url: URL } },
      })
      await prisma.$connect()
      const out = await prismaScan(prisma, false)
      await prisma.$disconnect()
      return out
    },
  },
  b: {
    label: 'B  pg + pg-cursor + encoder',
    run: () => pgScan('object', true),
  },
  'b-': {
    label: 'B- pg + pg-cursor, rows discarded',
    run: () => pgScan('object', false),
  },
  c: {
    label: 'C  pg rowMode:array + encoder',
    run: () => pgScan('array', true),
  },
  'c-': {
    label: 'C- pg rowMode:array, rows discarded',
    run: () => pgScan('array', false),
  },
  d: { label: 'D  COPY TO STDOUT + encoder', run: () => copyScan(true) },
  'd-': {
    label: 'D- COPY TO STDOUT, rows discarded',
    run: () => copyScan(false),
  },
}

const main = async () => {
  const which = process.argv[2]
  if (which === 'server') return serverSide()
  const variant = VARIANTS[which ?? '']
  if (!variant) {
    console.error(
      `usage: driverbench <${Object.keys(VARIANTS).join('|')}|server>`,
    )
    process.exit(1)
    return
  }
  const runs = Number(process.env.RUNS ?? 5)
  if (!Number.isInteger(runs) || runs < 1) {
    console.error(
      `RUNS must be a positive integer; got ${JSON.stringify(process.env.RUNS)}`,
    )
    process.exit(1)
    return
  }
  let best: {
    rows: number
    ms: number
    cpu: number
    phases: Phase
    bytes?: number
  } | null = null
  // gcPauses/gcTotal accumulate for the life of the process, so the totals at
  // the end cover every run. The line below reports the *best* run's CPU, so
  // pair it with that run's GC slice or the two describe different things.
  let bestGcPauses: number[] = []
  let bestGcTotal = 0
  const all: number[] = []
  for (let i = 0; i < runs; i++) {
    const pausesBefore = gcPauses.length
    const totalBefore = gcTotal
    const r = await variant.run()
    all.push(r.cpu)
    if (!best || r.cpu < best.cpu) {
      best = r
      bestGcPauses = gcPauses.slice(pausesBefore)
      bestGcTotal = gcTotal - totalBefore
    }
  }
  all.sort((x, y) => x - y)
  // The RUNS guard above means the loop ran at least once, but that is a
  // runtime fact the compiler cannot follow — narrow rather than assert.
  if (!best) return
  report(`${variant.label} [fetch=${FETCH_SIZE}]`, best)
  console.log(
    `     CPU per run: ${all.map((m) => m.toFixed(0)).join(', ')} ms   ` +
      `gc: ${bestGcPauses.length} pauses / ${bestGcTotal.toFixed(0)} ms total / ` +
      `worst ${Math.max(0, ...bestGcPauses).toFixed(0)} ms`,
  )
}

void main()
