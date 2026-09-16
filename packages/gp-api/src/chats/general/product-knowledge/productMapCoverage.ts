// The backstop that keeps productMap.ts honest: every tab in the dashboard's
// nav must have a map entry, and every mapped nav id must still be a real tab.
//
// This is the last line, not the first. The point is that it never fires:
// the hook in .claude/settings.json runs it the moment an agent touches the
// nav, and the AGENTS.md next to this file tells it what to write. This only
// catches the change that got past both.
//
// Reading the nav by regex rather than importing it is deliberate. The nav
// registry is a .tsx client component that pulls in the styleguide, Clerk,
// and analytics, none of which can be imported into a gp-api test. So we scrape
// the ids and assert the scrape found a plausible number of them: a refactor
// that moves the registry somewhere else trips MIN_EXPECTED_NAV_IDS instead of
// silently passing with zero ids to check.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { PRODUCT_AREAS } from './productMap'

export const NAV_REGISTRY_PATH =
  'packages/gp-webapp/app/dashboard/shared/DashboardMenu.tsx'

// Nav entries that are not product areas and never need a map entry.
const NOT_A_PRODUCT_AREA = new Set(['nav-log-out'])

// A scrape that finds fewer than this many ids has stopped reading the real
// registry. 22 product ids exist today; the floor sits below that so adding or
// removing one tab is not itself a failure.
const MIN_EXPECTED_NAV_IDS = 15

export interface CoverageResult {
  navIds: string[]
  // In the nav, missing from the map. Someone shipped a feature the
  // assistants cannot see.
  unmapped: string[]
  // In the map, no longer in the nav. The assistants are describing something
  // that is gone.
  stale: string[]
}

// Walked up from the cwd rather than derived from this file's own path:
// gp-api compiles to CommonJS, so `import.meta` is a type error here, and
// `__dirname` differs between src and the built dist. The callers are a vitest
// run (cwd packages/gp-api) and the root script (cwd the repo root), and both
// resolve by looking for the nav registry itself.
const findRepoRoot = (): string => {
  let dir = process.cwd()
  while (!existsSync(resolve(dir, NAV_REGISTRY_PATH))) {
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(
        `Could not find ${NAV_REGISTRY_PATH} above ${process.cwd()}. The nav ` +
          'registry has probably moved; point this check at its new home.',
      )
    }
    dir = parent
  }
  return dir
}

const readNavIds = (repoRoot: string): string[] => {
  const source = readFileSync(resolve(repoRoot, NAV_REGISTRY_PATH), 'utf8')
  const ids = [...source.matchAll(/\bid:\s*'([a-z0-9-]+)'/g)]
    .map((m) => m[1])
    .filter((id): id is string => id !== undefined)
  const unique = [...new Set(ids)]
  if (unique.length < MIN_EXPECTED_NAV_IDS) {
    throw new Error(
      `Found only ${unique.length} nav ids in ${NAV_REGISTRY_PATH}, expected ` +
        `at least ${MIN_EXPECTED_NAV_IDS}. The nav registry has probably moved ` +
        'or changed shape. Point this check at its new home rather than ' +
        'lowering the floor.',
    )
  }
  return unique.filter((id) => !NOT_A_PRODUCT_AREA.has(id))
}

export const checkProductMapCoverage = (repoRoot?: string): CoverageResult => {
  const navIds = readNavIds(repoRoot ?? findRepoRoot())
  const mapped = new Set(
    PRODUCT_AREAS.map((a) => a.navId).filter((id): id is string => id !== null),
  )
  return {
    navIds,
    unmapped: navIds.filter((id) => !mapped.has(id)),
    stale: [...mapped].filter((id) => !navIds.includes(id)),
  }
}

// One message, written for whoever (or whatever) is about to fix it.
export const formatCoverageFailure = (result: CoverageResult): string => {
  const lines: string[] = []
  if (result.unmapped.length > 0) {
    lines.push(
      'These dashboard tabs have no entry in the product map, so neither the',
      'Campaign Manager nor the Chief of Staff knows they exist:',
      ...result.unmapped.map((id) => `  - ${id}`),
      '',
      'Add a ProductArea for each in',
      'packages/gp-api/src/chats/general/product-knowledge/productMap.ts:',
      'the tab name exactly as the left rail spells it, its path, which',
      'product(s) have it, one sentence on what the user does there, and any',
      'access gate. Read that directory’s AGENTS.md first.',
    )
  }
  if (result.stale.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(
      'The product map describes these nav ids, which no longer exist:',
      ...result.stale.map((id) => `  - ${id}`),
      '',
      'Delete those entries, or repoint them at the id that replaced them.',
      'The assistants are currently telling users to click something that is gone.',
    )
  }
  return lines.join('\n')
}
