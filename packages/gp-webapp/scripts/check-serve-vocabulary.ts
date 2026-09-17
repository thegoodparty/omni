#!/usr/bin/env tsx
// Serve vocabulary gate, as a CLI.
//
//   npm run check:serve-vocabulary -w packages/gp-webapp        # whole package
//   npx tsx scripts/check-serve-vocabulary.ts app/serve/page.tsx  # named files
//
// Run by the PostToolUse hook in .claude/settings.json against just the file an
// agent touched, so Serve copy is fixed while it is being written. The same
// check runs as a Vitest test, which is what fails CI — see serveVocabulary.ts.
//
// Keep this a thin wrapper: the logic is shared with that test so the hook and
// the gate can never disagree about what passes.

import { relative, sep } from 'node:path'
import {
  PACKAGE_ROOT,
  VIOLATION_GUIDANCE,
  formatViolations,
  isScannablePath,
  scanServeVocabulary,
  serveVocabularyFiles,
} from './serveVocabulary'

// Serve copy saying a Win-only word exits 2, not 1, so callers can tell a
// verdict from a crash. The check itself can exit 1 for reasons that say
// nothing about the copy (an unreadable package, tsx failing to start), and a
// caller that treats those as "the copy is wrong" sends whoever reads it to
// edit the wrong file. Same contract as scripts/product-map-coverage.ts.
const VIOLATION_EXIT_CODE = 2

// Accepts absolute or repo-relative paths and normalizes them to the
// package-relative, POSIX-separated form the scanner matches on.
const toPackageRelative = (arg: string): string =>
  (arg.startsWith(PACKAGE_ROOT)
    ? relative(PACKAGE_ROOT, arg)
    : arg.replace(/^.*packages\/gp-webapp\//, '')
  )
    .split(sep)
    .join('/')

const main = async (): Promise<void> => {
  const args = process.argv.slice(2).map(toPackageRelative)
  // Named files are screened by predicate rather than against a walk of the
  // package: the per-edit hook runs this on one file and should not pay to
  // enumerate 1,100 others to decide it.
  const targets =
    args.length > 0
      ? args.filter(isScannablePath)
      : await serveVocabularyFiles()

  // Named files that this package does not scan (another package, a test, a
  // deleted path) are not a verdict about anything.
  if (args.length > 0 && targets.length === 0) return

  const violations = await scanServeVocabulary(targets)

  if (violations.length > 0) {
    console.error(
      `\nServe copy uses Win-only words (${violations.length} ${
        violations.length === 1 ? 'place' : 'places'
      }).\n`,
    )
    console.error(formatViolations(violations))
    console.error(`\n${VIOLATION_GUIDANCE}\n`)
    process.exit(VIOLATION_EXIT_CODE)
  }

  console.log(
    `Serve vocabulary clean across ${targets.length} ${
      targets.length === 1 ? 'file' : 'files'
    }.`,
  )
}

void main()
