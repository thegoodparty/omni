// Daily horizon check for the real-world data the e2e suite still depends on.
//
// Test campaigns take their election date from a preset, but some specs still
// lean on real offices: the default office every campaign is created on, and
// the offices the onboarding and office-picker specs pick through the UI. This
// asks dev's public races route about each one in
// e2e-tests/src/real-world-references.json and fails, with a job summary, when
// a reference is about to stop holding: an office that no longer resolves, or
// an upcoming race that is gone or less than HORIZON_DAYS away. That turns the
// next "default race passed" break into a red scheduled run weeks ahead.
//
// Run by .github/workflows/e2e-horizon.yml. Plain Node, no dependencies, so the
// workflow needs no npm install.
//
//   node packages/gp-webapp/scripts/check-e2e-horizon.mjs
//   E2E_HORIZON_API=http://localhost:3000 node ...   # another gp-api

import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const HORIZON_DAYS = 30
const DEFAULT_API = 'https://gp-api-dev.goodparty.org'
const REFERENCES_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../e2e-tests/src/real-world-references.json',
)

const DAY_MS = 24 * 60 * 60 * 1000

// electionDay is yyyy-MM-dd; both sides are UTC midnights, so whole days.
export const daysUntil = (electionDay, today) =>
  Math.round((Date.parse(`${electionDay}T00:00:00Z`) - today) / DAY_MS)

export const utcToday = (now = new Date()) =>
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())

const matches = (reference, race) =>
  reference.office
    ? race.position.name === reference.office
    : reference.officeContains
      ? race.position.name.includes(reference.officeContains)
      : true

const earliest = (races) =>
  [...races].sort((a, b) =>
    a.election.electionDay.localeCompare(b.election.electionDay),
  )[0]

// One verdict per reference: { ok, next, detail }. `next` is the nearest
// upcoming election day the reference sees, for the summary.
export const assessReference = (reference, { future, past }, today) => {
  const upcoming = future.filter((race) => matches(reference, race))
  const next = earliest(upcoming)?.election.electionDay ?? null

  if (reference.needs === 'exists') {
    const found =
      upcoming.length + past.filter((r) => matches(reference, r)).length
    return found > 0
      ? { ok: true, next, detail: 'Resolves (upcoming or past).' }
      : {
          ok: false,
          next,
          detail: `No race at all for this office at ${reference.zip}.`,
        }
  }

  const clear = upcoming.filter(
    (race) => daysUntil(race.election.electionDay, today) >= HORIZON_DAYS,
  )
  if (reference.office) {
    const need = reference.minRaces ?? 1
    if (upcoming.length === 0) {
      return { ok: false, next, detail: 'No upcoming race.' }
    }
    if (clear.length < need) {
      return {
        ok: false,
        next,
        detail:
          `Needs ${need} upcoming race(s) at least ${HORIZON_DAYS} days out; ` +
          `has ${clear.length}. Next is ${next}, ` +
          `${daysUntil(next, today)} days away.`,
      }
    }
    return { ok: true, next, detail: `${clear.length} race(s) clear.` }
  }

  const need = reference.minOffices ?? 1
  const offices = new Set(clear.map((race) => race.position.name))
  return offices.size >= need
    ? { ok: true, next, detail: `${offices.size} office(s) clear.` }
    : {
        ok: false,
        next,
        detail:
          `Needs ${need} office(s) with a race at least ${HORIZON_DAYS} days ` +
          `out; has ${offices.size}.`,
      }
}

const fetchRaces = async (api, zip, timeframe) => {
  const url = new URL('/v1/elections/races-by-year', api)
  url.searchParams.set('zipcode', zip)
  if (timeframe === 'past') url.searchParams.set('timeframe', 'past')
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) {
    throw new Error(`GET ${url} answered ${response.status}`)
  }
  return response.json()
}

export const renderSummary = (rows, today) => {
  const failed = rows.filter((row) => !row.verdict.ok)
  const header = failed.length
    ? `## E2E horizon check: ${failed.length} reference(s) need attention`
    : '## E2E horizon check: every reference holds'
  const lines = [
    header,
    '',
    `Checked ${new Date(today).toISOString().slice(0, 10)} against dev, ` +
      `horizon ${HORIZON_DAYS} days.`,
    '',
    '| Reference | Needs | Next election | Verdict | Used by |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(
      ({ reference, verdict }) =>
        `| \`${reference.id}\` (${reference.zip}${
          reference.office ? `, ${reference.office}` : ''
        }) | ${reference.needs} | ${verdict.next ?? 'none'} | ${
          verdict.ok ? 'OK' : 'FAIL'
        }: ${verdict.detail} | ${reference.usedBy} |`,
    ),
  ]
  if (failed.length) {
    lines.push(
      '',
      'A failing reference means the specs that use it will break when the ' +
        'race passes. Point them at an office with a later race, or give them ' +
        'a declared state instead (see `e2e-tests/AGENTS.md`), then update ' +
        '`e2e-tests/src/real-world-references.json`.',
    )
  }
  return `${lines.join('\n')}\n`
}

const main = async () => {
  const api = process.env.E2E_HORIZON_API || DEFAULT_API
  const { references } = JSON.parse(readFileSync(REFERENCES_PATH, 'utf8'))
  const today = utcToday()
  const byZip = new Map()
  for (const zip of new Set(references.map((reference) => reference.zip))) {
    byZip.set(zip, {
      future: await fetchRaces(api, zip, 'future'),
      past: await fetchRaces(api, zip, 'past'),
    })
  }
  const rows = references.map((reference) => ({
    reference,
    verdict: assessReference(reference, byZip.get(reference.zip), today),
  }))
  const summary = renderSummary(rows, today)
  process.stdout.write(summary)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
  }
  for (const { reference, verdict } of rows) {
    if (!verdict.ok) {
      process.stdout.write(`::error::${reference.id}: ${verdict.detail}\n`)
    }
  }
  process.exitCode = rows.every((row) => row.verdict.ok) ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    process.stdout.write(`::error::E2E horizon check could not run: ${err}\n`)
    process.exit(1)
  })
}
