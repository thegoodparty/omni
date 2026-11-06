import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  S3Client,
} from '@aws-sdk/client-s3'
import { z } from 'zod'

// ENG-11593: `judge spend` needs the case scout's own nightly spend
// alongside the guard ledger's, so it can print one total per the TDD's
// "Jeff wants eval spend reported on its own line per piece (scout, guard,
// climb)". The scout keeps its own bucket (`case-scout-<env>`, a separate
// bucket and a separate IAM role from the judge's — see
// packages/gp-ai/case_scout/bucket.py's own header) and writes one
// `runs/<runId>/record.json` per night with a `spendUsd.total` field
// (packages/gp-ai/case_scout/reader/main.py). This module is a minimal,
// read-only TypeScript mirror of exactly the two bucket.py methods `judge
// spend` needs — `list_run_ids_for_month` and `read_run_record` — not a
// general scout client.
//
// Run ids are calendar dates (`YYYY-MM-DD`, set by the scout's own
// `night.run_night(run_id=run_date)`), so a prefix listing on
// `runs/<yyyymm>` finds exactly that month's runs, same as the Python side.
export interface ScoutRunRecord {
  readonly spendUsd?: { readonly total?: number }
}

export interface ScoutSpendPort {
  listRunIds: (yyyyMm: string) => Promise<string[]>
  readRunRecord: (runId: string) => Promise<ScoutRunRecord | undefined>
}

const recordKey = (runId: string): string => `runs/${runId}/record.json`

export const s3ScoutSpendPort = (
  client: S3Client,
  bucket: string,
): ScoutSpendPort => ({
  listRunIds: async (yyyyMm) => {
    const runIds = new Set<string>()
    let continuationToken: string | undefined
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: `runs/${yyyyMm}`,
          ContinuationToken: continuationToken,
        }),
      )
      for (const object of page.Contents ?? []) {
        const parts = (object.Key ?? '').split('/')
        if (parts.length === 3 && parts[0] === 'runs' && parts[2] === 'record.json') {
          runIds.add(parts[1] ?? '')
        }
      }
      continuationToken = page.NextContinuationToken
    } while (continuationToken !== undefined)
    return [...runIds].sort()
  },

  readRunRecord: async (runId) => {
    try {
      const output = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: recordKey(runId) }),
      )
      if (output.Body === undefined) return undefined
      const text = await output.Body.transformToString('utf8')
      return ScoutRunRecordSchema.parse(JSON.parse(text))
    } catch (err) {
      if (err instanceof NoSuchKey) return undefined
      throw err
    }
  },
})

const ScoutRunRecordSchema = z.object({
  spendUsd: z
    .object({ total: z.number().nonnegative().optional() })
    .optional(),
})

// Local directory fallback, same shape as guardLedgerStore.ts's — the
// scout's bucket is a separate IAM boundary from the judge's, so a dev box
// or a test with no AWS role for that bucket reads an empty local directory
// as "no scout runs" rather than throwing.
export const localScoutSpendPort = (root: string): ScoutSpendPort => {
  const resolvedRoot = path.resolve(root)
  return {
    listRunIds: async (yyyyMm) => {
      let entries: string[]
      try {
        entries = await readdir(path.join(resolvedRoot, 'runs'))
      } catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
          return []
        }
        throw err
      }
      return entries.filter((runId) => runId.startsWith(yyyyMm)).sort()
    },
    readRunRecord: async (runId) => {
      try {
        const text = await readFile(
          path.join(resolvedRoot, 'runs', runId, 'record.json'),
          'utf8',
        )
        return ScoutRunRecordSchema.parse(JSON.parse(text))
      } catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
          return undefined
        }
        throw err
      }
    },
  }
}

// Months, oldest first — `judge spend`'s own bound on "grand total", same
// trailing-window idiom as guardLedger.ts's recentMonthKeys: a true,
// unbounded history needs a month-listing capability neither bucket exposes
// today, and 12 months already spans more than one calibration cycle.
export const SPEND_HISTORY_MONTHS = 12

export const scoutSpendForMonth = async (
  port: ScoutSpendPort,
  yyyyMm: string,
): Promise<number> => {
  const runIds = await port.listRunIds(yyyyMm)
  const records = await Promise.all(runIds.map((id) => port.readRunRecord(id)))
  return records.reduce(
    (total, record) => total + (record?.spendUsd?.total ?? 0),
    0,
  )
}

export const scoutSpendOverMonths = async (
  port: ScoutSpendPort,
  yyyyMms: readonly string[],
): Promise<number> => {
  const totals = await Promise.all(
    yyyyMms.map((yyyyMm) => scoutSpendForMonth(port, yyyyMm)),
  )
  return totals.reduce((sum, one) => sum + one, 0)
}
