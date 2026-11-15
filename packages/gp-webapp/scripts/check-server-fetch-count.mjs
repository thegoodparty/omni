#!/usr/bin/env node
// Server-render fetch ratchet.
//
// Counts the route files under app/ (page, layout, template) that call
// `serverRequest(` and fails (exit 1) if that count exceeds the committed
// baseline below. A page's gp-api data loads in the browser by default; a
// server render calls gp-api only to decide access or a 404, or for a cheap
// shell field (docs/state-management.md § Load gp-api data in the browser).
// This stops new pages from copying the pattern behind the 2026-11-04
// outage, where the priority page waited on a slow read in its server render.
//
// RATCHET POLICY:
//   - When you MOVE a page's data to the browser so its route file no longer
//     calls `serverRequest`, lower BASELINE to the new count this script
//     prints. That locks in the win.
//   - Do NOT raise BASELINE to make a red build green. A new page that truly
//     needs gp-api in its server render (a 404 or access decision) raises it
//     in the SAME PR with a one-line note here saying what the call decides.
//
// Run: `npm run check:server-fetch -w packages/gp-webapp`

import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

// 2026-11-13: initial baseline 18, measured on main. Every one of them is a
// dashboard or onboarding page; the two priority pages count because they
// still fetch the priority itself to 404 on, while their read and results
// load in the browser.
const BASELINE = 18

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const IGNORED_DIRS = new Set(['node_modules', '.next', 'dist'])
const ROUTE_FILE = /^(page|layout|template)\.(tsx|ts|jsx|js)$/

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      yield* walk(fullPath)
    } else if (ROUTE_FILE.test(entry.name)) {
      yield fullPath
    }
  }
}

const routeFiles = []
for await (const file of walk(join(PACKAGE_ROOT, 'app'))) {
  const contents = await readFile(file, 'utf8')
  if (/\bserverRequest\s*[<(]/.test(contents)) {
    routeFiles.push(relative(PACKAGE_ROOT, file))
  }
}

const count = routeFiles.length
console.log(
  `route files calling serverRequest: ${count} (baseline ${BASELINE})`,
)

if (count > BASELINE) {
  console.error(
    `\nERROR: ${count} route files call serverRequest, above the baseline of ${BASELINE}.`,
  )
  console.error(
    'Load the page data in the browser with React Query and clientRequest ' +
      '(docs/state-management.md § Load gp-api data in the browser). If the ' +
      'server render truly needs gp-api to decide access or a 404, raise ' +
      'BASELINE in scripts/check-server-fetch-count.mjs in this PR and note why.',
  )
  for (const file of routeFiles.sort()) console.error(`  ${file}`)
  process.exit(1)
}

if (count < BASELINE) {
  console.log(
    `Nice — ${BASELINE - count} below baseline. Lower BASELINE to ${count} in ` +
      'scripts/check-server-fetch-count.mjs to lock in the win.',
  )
}
