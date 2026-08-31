import { execFileSync, execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

// dist/ and src/generated/ are both gitignored, so a fresh clone or a new
// worktree has neither until something builds them. Consumers resolve this
// package through its `main`/`types` entries, which point into dist/ — so a
// missing or stale dist does not fail as "run the build first". It fails as
// whatever the last build happened to export, which reads as a genuine break
// in the consumer: imports resolving to undefined, and errors like
// "PACK_AGE_BUCKETS is not iterable" several layers away from the real cause.
//
// CI never sees this — setup-node-workspace builds contracts up front for
// every workflow. This exists for local runs, where nothing did.
//
// The caller passes the root so this module stays free of __dirname and
// import.meta: it is loaded both by tsx as CJS and by vitest as ESM, and
// neither idiom is valid in both.

// Staleness is mtime-based: a checkout that brings in newer sources restamps
// them past dist, which is the case that matters. The inverse — rebuilding
// dist and then checking out older sources — is not detected, and is the
// known limit of comparing timestamps rather than hashing content.
const isUpToDate = (contractsRoot: string): boolean => {
  const dist = join(contractsRoot, 'dist', 'index.js')
  if (!existsSync(dist)) return false

  try {
    const newer = execFileSync(
      'find',
      [
        join(contractsRoot, 'src'),
        join(contractsRoot, 'scripts'),
        '-name',
        '*.ts',
        '-newer',
        dist,
      ],
      { encoding: 'utf8' },
    ).trim()

    return newer.length === 0
  } catch {
    // A failed probe says nothing about freshness, so rebuild rather than let
    // an unreadable tree pass as current.
    return false
  }
}

export const ensureContractsBuilt = (contractsRoot: string): void => {
  if (isUpToDate(contractsRoot)) return

  console.log('contracts: dist is missing or stale, building it')
  execSync('npm run build', { stdio: 'inherit', cwd: contractsRoot })
}
