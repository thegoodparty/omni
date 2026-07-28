/**
 * Backfill hs_column / position_phrase / position_dir onto historical
 * race_opponent_standout_action rows.
 *
 * The deployed pipeline dropped the Haystaq column identity everywhere, so
 * cards written before the persist fix carry a district percentage in their
 * copy but no record of WHICH hs_* column it came from. This script re-attaches
 * that identity from the reviewed mapping committed at
 * scripts/data/standout-haystaq-issue-map.json (produced offline by the
 * recommended-lists POC), matching each mapped issue to its card by the
 * percentage the card's text quotes. Counts are NOT backfilled — the mapping
 * carries only the cited percentage, so haystaq_* stat columns stay null; a
 * fresh agent run is what populates them going forward.
 *
 * Matching is a text fingerprint, not the mapping's standout_order: order can
 * drift between the frozen artifact and the persisted rows, but the exact
 * percentage a card quotes uniquely identifies it. A percentage that matches
 * zero or more than one card is left unresolved and skipped — never guessed.
 *
 * Idempotent: each stamp is guarded on the row still having hsColumn = null,
 * so re-runs and already-stamped rows match zero rows.
 *
 * Usage:
 *   npx tsx scripts/backfill-standout-action-haystaq.ts            # dry run
 *   npx tsx scripts/backfill-standout-action-haystaq.ts --execute  # apply
 *
 * Required env vars:
 *   DATABASE_URL — Postgres connection string for the target environment
 *
 * Output (written to scripts/output/, gitignored):
 *   standout-haystaq-backfill-summary.json
 */
import 'dotenv/config'
import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { PrismaClient } from '../src/generated/prisma'

const IssueEntrySchema = z.object({
  hs_column: z.string().min(1),
  phrase: z.string().min(1),
  cited_pct: z.number(),
  dir: z.enum(['high', 'low']),
})
export type IssueEntry = z.infer<typeof IssueEntrySchema>

const IssueMapSchema = z.record(
  z.string(),
  z.object({ issues: z.array(IssueEntrySchema) }),
)
export type IssueMap = z.infer<typeof IssueMapSchema>

export type StandoutRow = {
  id: number
  body: string
  smsMessage: string
  hsColumn: string | null
}

export type MatchOutcome =
  | { status: 'stamp'; row: StandoutRow }
  | { status: 'already' }
  | { status: 'no_match' }
  | { status: 'ambiguous' }

// The text forms a card might quote for a cited percentage: the canonical
// one-decimal form, the bare stringified number, and (when the value is whole)
// the no-decimal integer form. JSON drops a trailing .0, so an integral
// cited_pct arrives here as a plain number.
export const pctVariants = (pct: number): string[] => {
  const variants = new Set<string>([`${pct.toFixed(1)}%`, `${pct}%`])
  if (Number.isInteger(pct)) variants.add(`${pct.toFixed(0)}%`)
  return [...variants]
}

// Fingerprint one mapped issue to its card by the percentage the card quotes.
// Body is authoritative; smsMessage is consulted only when no body matches, so
// a stat that lives in a body never competes with the same stat in another
// card's sms. Zero or multiple matches are unresolved (never stamped).
export const matchIssue = (
  rows: StandoutRow[],
  issue: IssueEntry,
): MatchOutcome => {
  const variants = pctVariants(issue.cited_pct)
  const hits = (text: string) => variants.some((v) => text.includes(v))
  const byBody = rows.filter((r) => hits(r.body))
  const matches =
    byBody.length > 0 ? byBody : rows.filter((r) => hits(r.smsMessage))

  if (matches.length === 0) return { status: 'no_match' }
  if (matches.length > 1) return { status: 'ambiguous' }
  const [row] = matches
  return row.hsColumn === null
    ? { status: 'stamp', row }
    : { status: 'already' }
}

export type SlugReport = {
  slug: string
  found: boolean
  issues: number
  stamped: number
  already: number
  unresolved: { hsColumn: string; citedPct: number; reason: string }[]
}

export const loadIssueMap = (path: string): IssueMap =>
  IssueMapSchema.parse(JSON.parse(readFileSync(path, 'utf8')))

export const backfill = async (
  prisma: PrismaClient,
  map: IssueMap,
  execute: boolean,
): Promise<SlugReport[]> => {
  const reports: SlugReport[] = []
  for (const [slug, { issues }] of Object.entries(map)) {
    const campaign = await prisma.campaign.findUnique({
      where: { slug },
      select: { id: true },
    })
    if (!campaign) {
      reports.push({
        slug,
        found: false,
        issues: issues.length,
        stamped: 0,
        already: 0,
        unresolved: [],
      })
      continue
    }

    const rows = await prisma.raceOpponentStandoutAction.findMany({
      where: { campaignId: campaign.id },
      select: { id: true, body: true, smsMessage: true, hsColumn: true },
    })

    const report: SlugReport = {
      slug,
      found: true,
      issues: issues.length,
      stamped: 0,
      already: 0,
      unresolved: [],
    }
    for (const issue of issues) {
      const outcome = matchIssue(rows, issue)
      if (outcome.status === 'already') {
        report.already += 1
      } else if (outcome.status === 'stamp') {
        if (execute) {
          // Guarded on hsColumn still null so a concurrent write or re-run
          // matches zero rows instead of clobbering a newer stamp.
          await prisma.raceOpponentStandoutAction.updateMany({
            where: { id: outcome.row.id, hsColumn: null },
            data: {
              hsColumn: issue.hs_column,
              positionPhrase: issue.phrase,
              positionDir: issue.dir,
            },
          })
        }
        // Reflect the stamp locally so a second mapped issue can't re-match the
        // same row within this run.
        outcome.row.hsColumn = issue.hs_column
        report.stamped += 1
      } else {
        report.unresolved.push({
          hsColumn: issue.hs_column,
          citedPct: issue.cited_pct,
          reason: outcome.status,
        })
      }
    }
    reports.push(report)
  }
  return reports
}

const main = async () => {
  const execute = process.argv.includes('--execute')
  const map = loadIssueMap(
    join(__dirname, 'data', 'standout-haystaq-issue-map.json'),
  )

  const prisma = new PrismaClient()
  try {
    const reports = await backfill(prisma, map, execute)

    const summary = {
      mode: execute ? 'execute' : 'dry-run',
      ranAt: new Date().toISOString(),
      slugs: reports.length,
      campaignsNotFound: reports.filter((r) => !r.found).map((r) => r.slug),
      totalIssues: reports.reduce((n, r) => n + r.issues, 0),
      stamped: reports.reduce((n, r) => n + r.stamped, 0),
      alreadyStamped: reports.reduce((n, r) => n + r.already, 0),
      unresolved: reports.reduce((n, r) => n + r.unresolved.length, 0),
    }

    const outDir = join(__dirname, 'output')
    mkdirSync(outDir, { recursive: true })
    writeFileSync(
      join(outDir, 'standout-haystaq-backfill-summary.json'),
      JSON.stringify({ summary, reports }, null, 2),
    )
    console.log(JSON.stringify({ summary, reports }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

if (process.argv[1]?.includes('backfill-standout-action-haystaq')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
