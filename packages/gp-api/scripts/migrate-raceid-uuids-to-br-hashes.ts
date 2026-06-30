/**
 * ENG-10240 — Migrate campaign.details.raceId UUIDs back to BallotReady
 * race hashes.
 *
 * Between 2026-05-06 and the office-picker fix, campaigns created or
 * re-saved through the pickers stored a ZipToPosition.id UUID in
 * details.raceId instead of the Race.br_hash_id the rest of the system
 * keys on (filing fees, campaign strategy, election-api lookups).
 *
 * This script applies the pre-resolved, reviewed mapping committed at
 * scripts/data/eng-10240-raceid-mapping.json. Resolution was done against
 * the dbt mart (goodparty_data_catalog.dbt.m_election_api__race) by
 * re-deriving each campaign's race from its own office data —
 * (organization.position_id, details.electionDate) — rather than chasing
 * the corrupt UUID, since ZipToPosition ids are loader-minted and absent
 * from the mart. Races sharing a date (multiple seats) were picked by
 * is_runoff/is_primary NULLS FIRST priority and are flagged with a note
 * in the mapping. Unresolvable campaigns (race rows pruned from the mart)
 * are listed under `unresolved` and intentionally left untouched.
 *
 * Idempotent by construction: each UPDATE is guarded on the campaign still
 * holding the exact expected UUID, so re-runs and already-migrated rows
 * match zero rows. Anything whose current value is neither the expected
 * UUID nor the target hash is reported as a mismatch and left alone.
 *
 * Usage:
 *   npx tsx scripts/migrate-raceid-uuids-to-br-hashes.ts            # dry run
 *   npx tsx scripts/migrate-raceid-uuids-to-br-hashes.ts --execute  # apply
 *
 * Required env vars:
 *   DATABASE_URL — Postgres connection string for the target environment
 *
 * Output (written to scripts/output/, gitignored):
 *   eng-10240-raceid-migration-summary.json
 */
import 'dotenv/config'
import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { Prisma, PrismaClient } from '../src/generated/prisma'

const MappingSchema = z.object({
  ticket: z.string(),
  generatedAt: z.string(),
  resolution: z.string(),
  migrate: z.array(
    z.object({
      campaignId: z.number().int(),
      expectedUuid: z.string().uuid(),
      brHashId: z.string().startsWith('Z2lk'),
      note: z.string().optional(),
    }),
  ),
  unresolved: z.array(
    z.object({
      campaignId: z.number().int(),
      expectedUuid: z.string().uuid(),
      reason: z.string(),
    }),
  ),
})

export type RaceIdMapping = z.infer<typeof MappingSchema>

type EntryStatus = 'pending' | 'done' | 'missing' | 'mismatch'

export type EntryReport = {
  campaignId: number
  status: EntryStatus
  currentRaceId: string | null
  updated: boolean
}

export const loadMapping = (path: string): RaceIdMapping =>
  MappingSchema.parse(JSON.parse(readFileSync(path, 'utf8')))

const classify = (
  current: string | null | undefined,
  entry: RaceIdMapping['migrate'][number],
): EntryStatus =>
  current === undefined || current === null
    ? 'missing'
    : current === entry.brHashId
      ? 'done'
      : current === entry.expectedUuid
        ? 'pending'
        : 'mismatch'

export const migrateRaceIds = async (
  prisma: PrismaClient,
  mapping: RaceIdMapping,
  execute: boolean,
): Promise<EntryReport[]> => {
  const ids = mapping.migrate.map((m) => m.campaignId)
  const rows = await prisma.$queryRaw<
    { id: number; race_id: string | null }[]
  >`SELECT id, details->>'raceId' AS race_id
    FROM campaign WHERE id IN (${Prisma.join(ids)})`
  const currentById = new Map(rows.map((r) => [r.id, r.race_id]))

  const reports: EntryReport[] = []
  for (const entry of mapping.migrate) {
    const current = currentById.has(entry.campaignId)
      ? currentById.get(entry.campaignId)
      : undefined
    const status = classify(current, entry)
    let updated = false

    if (status === 'pending' && execute) {
      // Guarded on the exact expected UUID so a concurrent change (or a
      // re-run) matches zero rows instead of clobbering newer data.
      const count = await prisma.$executeRaw`
        UPDATE campaign
        SET details = jsonb_set(details, '{raceId}', to_jsonb(${entry.brHashId}::text)),
            updated_at = NOW()
        WHERE id = ${entry.campaignId}
          AND details->>'raceId' = ${entry.expectedUuid}`
      updated = count === 1
    }

    reports.push({
      campaignId: entry.campaignId,
      status: updated ? 'done' : status,
      currentRaceId: current ?? null,
      updated,
    })
  }
  return reports
}

const main = async () => {
  const execute = process.argv.includes('--execute')
  const mapping = loadMapping(
    join(__dirname, 'data', 'eng-10240-raceid-mapping.json'),
  )

  const prisma = new PrismaClient()
  try {
    const reports = await migrateRaceIds(prisma, mapping, execute)

    const byStatus = (s: EntryStatus) => reports.filter((r) => r.status === s)
    const summary = {
      mode: execute ? 'execute' : 'dry-run',
      ranAt: new Date().toISOString(),
      mappingGeneratedAt: mapping.generatedAt,
      total: reports.length,
      pending: byStatus('pending').length,
      updated: reports.filter((r) => r.updated).length,
      alreadyDone: byStatus('done').length,
      mismatched: byStatus('mismatch').map((r) => ({
        campaignId: r.campaignId,
        currentRaceId: r.currentRaceId,
      })),
      missingCampaigns: byStatus('missing').map((r) => r.campaignId),
      unresolvedLeftAsIs: mapping.unresolved.map((u) => u.campaignId),
    }

    const outDir = join(__dirname, 'output')
    mkdirSync(outDir, { recursive: true })
    writeFileSync(
      join(outDir, 'eng-10240-raceid-migration-summary.json'),
      JSON.stringify({ summary, reports }, null, 2),
    )
    console.log(JSON.stringify(summary, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

if (process.argv[1]?.includes('migrate-raceid-uuids-to-br-hashes')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
