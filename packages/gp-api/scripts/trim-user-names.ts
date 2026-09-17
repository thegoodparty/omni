/**
 * ENG-5508: trim leading/trailing whitespace from user.first_name and
 * user.last_name.
 *
 * A previous UI trimming bug left ~6.3k rows with untrimmed whitespace
 * in one or both name columns. That bug is fixed on the write side, but
 * the historical rows are still dirty and need a one-shot cleanup.
 *
 * Selection is the same predicate as the analysis query:
 *   TRIM(first_name) <> first_name OR TRIM(last_name) <> last_name
 * so nulls (SQL TRIM(null) = null) are skipped naturally and re-runs on
 * an already-clean row are no-ops.
 *
 * ─── Deployment behavior ─────────────────────────────────────────────
 * This is a one-shot backfill. Merging + deploying ships this file into
 * the production Docker image but DOES NOT auto-invoke it. A human runs
 * it explicitly once, then it can be removed.
 *
 * ─── How to run post-deploy ──────────────────────────────────────────
 *   1. Export prod creds locally (pull from AWS Secrets Manager / SSM):
 *        export DATABASE_URL='<prod Postgres URL>'
 *
 *   2. Dry-run first and inspect the plan:
 *        npx tsx scripts/trim-user-names.ts
 *        # review scripts/output/trim-user-names-detail.jsonl
 *
 *   3. Apply once the plan looks right:
 *        npx tsx scripts/trim-user-names.ts --apply
 *
 *   4. Re-run the ticket's SELECT (TRIM(first_name) <> first_name OR
 *      TRIM(last_name) <> last_name) against prod and confirm 0 rows.
 *
 * Output (written to scripts/output/, gitignored):
 *   trim-user-names-detail.jsonl   — one JSON line per user processed
 *   trim-user-names-summary.json   — totals + first 50 errors
 *
 * Required env vars:
 *   DATABASE_URL — Postgres connection string
 */
import { createWriteStream, mkdirSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { PrismaClient } from '../src/generated/prisma'

// A narrow write-line sink so the caller (main here, tests otherwise) can
// swap in a stream, a buffer, or nothing at all without coupling this
// module to node:fs.WriteStream.
type DetailSink = { write: (line: string) => void }
const noopSink: DetailSink = {
  write: () => {
    // The default sink for tests and callers that only want the stats.
  },
}

const BATCH_SIZE = 500
const OUTPUT_DIR = join(__dirname, 'output')
const DETAIL_PATH = join(OUTPUT_DIR, 'trim-user-names-detail.jsonl')
const SUMMARY_PATH = join(OUTPUT_DIR, 'trim-user-names-summary.json')

export type UserNameRow = {
  id: number
  firstName: string | null
  lastName: string | null
}

export type TrimmedUpdate = {
  firstName?: string
  lastName?: string
}

/**
 * Returns the fields that need to be written to make the row clean, or
 * null when the row is already clean. Preserving null-vs-empty on
 * untouched fields matters — writing the "trimmed" form of a null field
 * would turn it into an empty string and needlessly touch every clean
 * row.
 */
export const computeTrimmedUpdate = (
  row: UserNameRow,
): TrimmedUpdate | null => {
  const update: TrimmedUpdate = {}
  if (
    typeof row.firstName === 'string' &&
    row.firstName !== row.firstName.trim()
  ) {
    update.firstName = row.firstName.trim()
  }
  if (
    typeof row.lastName === 'string' &&
    row.lastName !== row.lastName.trim()
  ) {
    update.lastName = row.lastName.trim()
  }
  return Object.keys(update).length === 0 ? null : update
}

type Action = 'trimmed' | 'skipped-already-clean' | 'error'

type DetailEntry = {
  userId: number
  action: Action
  dryRun: boolean
  before?: { firstName: string | null; lastName: string | null }
  after?: TrimmedUpdate
  error?: string
}

type Stats = {
  scanned: number
  trimmed: number
  skippedAlreadyClean: number
  errors: { userId: number; error: string }[]
}

const fetchNextBatch = async (
  prisma: PrismaClient,
  afterId: number,
  batchSize: number,
): Promise<UserNameRow[]> => {
  const rows = await prisma.$queryRaw<UserNameRow[]>`
    SELECT id,
           first_name AS "firstName",
           last_name  AS "lastName"
    FROM "user"
    WHERE id > ${afterId}
      AND (TRIM(first_name) <> first_name OR TRIM(last_name) <> last_name)
    ORDER BY id
    LIMIT ${batchSize}
  `
  return rows
}

const processUser = async (
  prisma: PrismaClient,
  row: UserNameRow,
  isDryRun: boolean,
  stats: Stats,
  detailStream: DetailSink,
): Promise<void> => {
  const update = computeTrimmedUpdate(row)

  if (!update) {
    stats.skippedAlreadyClean++
    detailStream.write(
      JSON.stringify({
        userId: row.id,
        action: 'skipped-already-clean',
        dryRun: isDryRun,
      } satisfies DetailEntry) + '\n',
    )
    return
  }

  try {
    if (!isDryRun) {
      await prisma.user.update({
        where: { id: row.id },
        data: update,
      })
    }
    stats.trimmed++
    detailStream.write(
      JSON.stringify({
        userId: row.id,
        action: 'trimmed',
        dryRun: isDryRun,
        before: { firstName: row.firstName, lastName: row.lastName },
        after: update,
      } satisfies DetailEntry) + '\n',
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    stats.errors.push({ userId: row.id, error: message })
    detailStream.write(
      JSON.stringify({
        userId: row.id,
        action: 'error',
        dryRun: isDryRun,
        error: message,
      } satisfies DetailEntry) + '\n',
    )
  }
}

export type BackfillReport = {
  scanned: number
  trimmed: number
  skippedAlreadyClean: number
  errors: { userId: number; error: string }[]
}

/**
 * Streams every untrimmed user through the trim update. Exposed so the
 * DB integration test can drive it against a Postgres testcontainer.
 */
export const backfillTrimUserNames = async (
  prisma: PrismaClient,
  options: {
    isDryRun: boolean
    batchSize?: number
    detailStream?: DetailSink
    onProgress?: (stats: Stats) => void
  },
): Promise<BackfillReport> => {
  const {
    isDryRun,
    batchSize = BATCH_SIZE,
    detailStream = noopSink,
    onProgress,
  } = options
  const stats: Stats = {
    scanned: 0,
    trimmed: 0,
    skippedAlreadyClean: 0,
    errors: [],
  }

  let cursor = 0
  while (true) {
    const batch = await fetchNextBatch(prisma, cursor, batchSize)
    if (batch.length === 0) break
    cursor = batch[batch.length - 1].id
    stats.scanned += batch.length

    for (const row of batch) {
      await processUser(prisma, row, isDryRun, stats, detailStream)
    }

    onProgress?.(stats)
  }

  return stats
}

const main = async () => {
  const isDryRun = !process.argv.includes('--apply')

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const prisma = new PrismaClient()
  const detailStream = createWriteStream(DETAIL_PATH, { flags: 'w' })
  detailStream.on('error', (err) => {
    console.error('Detail stream error:', err)
    process.exitCode = 1
  })

  try {
    const startedAt = new Date().toISOString()
    const mode = isDryRun ? 'dry-run (no changes applied)' : 'APPLY'
    console.log(`trim-user-names started at ${startedAt} (${mode})`)
    console.log(`Streaming detail to: ${DETAIL_PATH}\n`)

    const stats = await backfillTrimUserNames(prisma, {
      isDryRun,
      detailStream,
      onProgress: (s) => {
        console.log(
          `  progress: ${s.scanned} scanned, ${s.trimmed} trimmed, ` +
            `${s.skippedAlreadyClean} already clean, ${s.errors.length} errors`,
        )
      },
    })

    const completedAt = new Date().toISOString()
    await writeFile(
      SUMMARY_PATH,
      JSON.stringify(
        {
          startedAt,
          completedAt,
          dryRun: isDryRun,
          scanned: stats.scanned,
          trimmed: stats.trimmed,
          skippedAlreadyClean: stats.skippedAlreadyClean,
          errors: stats.errors.length,
          errorDetails: stats.errors.slice(0, 50),
        },
        null,
        2,
      ) + '\n',
    )

    console.log(`\nCleanup complete at ${completedAt}`)
    console.log(`Mode: ${mode}`)
    console.log(`Scanned: ${stats.scanned}`)
    console.log(`Trimmed: ${stats.trimmed}`)
    console.log(`Already clean (raced): ${stats.skippedAlreadyClean}`)
    console.log(`Errors: ${stats.errors.length}`)
    if (stats.errors.length > 0) {
      console.log(`First 10 errors:`)
      for (const err of stats.errors.slice(0, 10)) {
        console.log(`  User ${err.userId}: ${err.error}`)
      }
    }
    console.log(`\nDetail: ${DETAIL_PATH}`)
    console.log(`Summary: ${SUMMARY_PATH}`)
  } finally {
    detailStream.end()
    await new Promise<void>((resolve) => detailStream.on('finish', resolve))
    await prisma.$disconnect()
  }
}

// Only invoke main when run directly via tsx / node. Under vitest the file
// is imported for its exports and must not open a Prisma client.
if (require.main === module) {
  main().catch((e) => {
    console.error('trim-user-names failed:', e)
    process.exit(1)
  })
}
