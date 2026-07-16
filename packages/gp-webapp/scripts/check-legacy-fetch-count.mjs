#!/usr/bin/env node
// Legacy-fetch ratchet.
//
// Counts the non-test source files under app/, helpers/, gpApi/, and pages/
// that import the deprecated fetch helpers (`clientFetch`, `serverFetch`,
// `gpFetch`) and fails (exit 1) if that count exceeds the committed baseline
// below. The typed system (`clientRequest`/`serverRequest` in
// gpApi/typed-request.ts and gpApi/server-request.ts) is canonical — see
// gpApi/CLAUDE.md. This ratchet stops NEW usage of the legacy helpers while
// the migration proceeds file-by-file.
//
// RATCHET POLICY:
//   - When you MIGRATE a file off the legacy helpers, lower BASELINE to the
//     new count this script prints. That locks in the win.
//   - Do NOT raise BASELINE to make a red build green. New code must use the
//     typed system; there is no justified reason to add a legacy import.
//
// Run: `npm run check:legacy-fetch -w packages/gp-webapp`

import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

// Lower this as files migrate to the typed system; never raise it (see
// RATCHET POLICY above).
// 2026-07-15: initial baseline 79, the count this script measures on develop
// (65 clientFetch + 15 serverFetch importers, one file importing both, zero
// gpFetch). The plan that introduced this ratchet estimated ~98, but that
// figure came from a looser content grep that also counted comments and
// indirect mentions; this script counts import specifiers only.
const BASELINE = 79

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCANNED_DIRS = ['app', 'helpers', 'gpApi', 'pages']
const IGNORED_DIRS = new Set(['node_modules', '.next', 'dist'])
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
// The legacy helpers themselves (and their registry) are allowed to reference
// each other; only consumers count against the baseline.
const SELF_FILES = new Set([
  'gpApi/clientFetch.ts',
  'gpApi/serverFetch.ts',
  'gpApi/gpFetch.ts',
  'gpApi/routes.ts',
])

const LEGACY_IMPORT_RE =
  /from\s+['"](?:[^'"]*\/)?(?:clientFetch|serverFetch|gpFetch)['"]/

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.git')) continue
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      yield* walk(fullPath)
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      yield fullPath
    }
  }
}

const legacyFiles = []
for (const dir of SCANNED_DIRS) {
  for await (const file of walk(join(PACKAGE_ROOT, dir))) {
    const relPath = relative(PACKAGE_ROOT, file)
    if (relPath.includes('.test.')) continue
    if (SELF_FILES.has(relPath)) continue
    const contents = await readFile(file, 'utf8')
    if (LEGACY_IMPORT_RE.test(contents)) {
      legacyFiles.push(relPath)
    }
  }
}

const count = legacyFiles.length
console.log(`Legacy fetch importers: ${count} (baseline ${BASELINE})`)

if (count > BASELINE) {
  console.error(
    `\nERROR: legacy fetch importer count ${count} exceeds baseline ${BASELINE}.`,
  )
  console.error(
    'clientFetch/serverFetch/gpFetch are deprecated — use the typed system ' +
      '(clientRequest/serverRequest, see gpApi/CLAUDE.md) instead of adding ' +
      'new legacy imports.',
  )
  process.exit(1)
}

if (count < BASELINE) {
  console.log(
    `Nice — ${BASELINE - count} below baseline. Consider lowering BASELINE to ` +
      `${count} in scripts/check-legacy-fetch-count.mjs to lock in the win.`,
  )
}
