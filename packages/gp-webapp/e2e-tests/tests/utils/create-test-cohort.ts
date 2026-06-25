import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import {
  createHeadlessTestUser,
  type HeadlessUserProduct,
} from './headless-user'

// Reusable cohort creator. Reads a selection file (produced by the
// create-representative-test-cohort skill's Databricks step) and creates one
// dev test user per entry, headless (no Playwright). Emits a manifest of the
// created orgs for hand-off to a dispatch skill.
//
// Run from packages/gp-webapp/e2e-tests with the dev env:
//   API_BASE_URL=https://dev.goodparty.org \
//   <repo>/node_modules/.bin/tsx tests/utils/create-test-cohort.ts \
//     --in <selection.json> --out <manifest.json>
//
// --dry-run creates the users + elected offices WITHOUT binding a position
// (and without picking a race). In dev (MEETINGS_AUTOMATION_ENABLED=true) a
// bound serve office auto-dispatches agent jobs on creation; an unbound office
// resolves no serve context, so nothing dispatches. Use it to exercise the full
// creation pipeline at scale without spending on agent runs.

type SelectionEntry = {
  // serve: bind the elected office to this election-api position id
  positionId?: string
  // win: pick the candidate race
  race?: { zip: string; office: string }
  // carried through to the manifest for analysis
  tier?: string
  voterCount?: number
  state?: string
  districtType?: string
}

type Selection = {
  product: HeadlessUserProduct
  termStartDate?: string
  termEndDate?: string
  entries: SelectionEntry[]
}

type ManifestEntry = SelectionEntry & {
  orgSlug: string
  clerkUserId: string
  userId: number
  email: string
}

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const inPath = arg('--in')
const outPath = arg('--out')
const dryRun = process.argv.includes('--dry-run')

if (!inPath || !outPath) {
  throw new Error(
    'usage: create-test-cohort.ts --in <selection.json> --out <manifest.json>',
  )
}

const selection: Selection = JSON.parse(readFileSync(inPath, 'utf8'))

const run = async () => {
  console.log(
    `cohort: product=${selection.product} entries=${selection.entries.length} dryRun=${dryRun}`,
  )
  const manifest: ManifestEntry[] = []
  const failures: { entry: SelectionEntry; error: string }[] = []

  for (const [i, entry] of selection.entries.entries()) {
    const label = entry.positionId ?? entry.race?.office ?? `#${i}`
    try {
      const created = await createHeadlessTestUser({
        product: selection.product,
        positionId: dryRun ? undefined : entry.positionId,
        race: dryRun ? undefined : entry.race,
        termStartDate: selection.termStartDate,
        termEndDate: selection.termEndDate,
      })
      if (!created.orgSlug) {
        throw new Error('no orgSlug returned')
      }
      manifest.push({
        ...entry,
        orgSlug: created.orgSlug,
        clerkUserId: created.clerkUserId,
        userId: created.user.id,
        email: created.user.email,
      })
      console.log(
        `[${i + 1}/${selection.entries.length}] ${label} -> ${created.orgSlug}`,
      )
    } catch (e) {
      const error =
        (e as { response?: { data?: unknown } })?.response?.data ??
        (e as Error)?.message ??
        String(e)
      failures.push({ entry, error: JSON.stringify(error) })
      console.error(
        `[${i + 1}/${selection.entries.length}] ${label} FAILED: ${JSON.stringify(error)}`,
      )
    }
  }

  writeFileSync(
    outPath,
    JSON.stringify(
      { product: selection.product, dryRun, created: manifest, failures },
      null,
      2,
    ),
  )
  console.log(
    `\ncreated ${manifest.length}/${selection.entries.length}; failures ${failures.length}`,
  )
  console.log('slugs:', JSON.stringify(manifest.map((m) => m.orgSlug)))
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
