#!/usr/bin/env tsx
// Checks that the assistants' product map still describes the real dashboard.
//
//   npm run product-map:check
//
// Run by the PostToolUse hook in .claude/settings.json the moment an agent
// edits the dashboard nav, so the fix happens while the feature is being
// built. The same check runs as a gp-api Vitest test, which is what fails CI.
//
// Keep this file a thin wrapper: the logic is shared with that test so the
// hook and the gate can never disagree about what passes.

import {
  checkProductMapCoverage,
  formatCoverageFailure,
} from '../packages/gp-api/src/chats/general/product-knowledge/productMapCoverage'

// A stale map exits 2, not 1, so callers can tell a verdict from a crash. The
// check itself can exit 1 for reasons that say nothing about the map (the nav
// registry moved and findRepoRoot threw, the scrape fell below its floor, tsx
// failed to start), and a caller that treats those as "map out of date" sends
// whoever is reading it to fix the wrong file.
const STALE_MAP_EXIT_CODE = 2

const result = checkProductMapCoverage()
const failure = formatCoverageFailure(result)

if (failure) {
  console.error('\nProduct map is out of date.\n')
  console.error(failure)
  console.error('')
  process.exit(STALE_MAP_EXIT_CODE)
}

console.log(
  `Product map covers all ${result.navIds.length} dashboard nav entries.`,
)
