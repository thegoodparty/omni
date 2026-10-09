#!/usr/bin/env tsx
// Checks that docs/feature-map.md still describes the real repo: every path it
// names exists, every dashboard nav id is on some "- Nav:" line (and nothing
// else is), and every top-level webapp route directory sits under some
// "- Route:" line.
//
//   npm run feature-map:check
//
// Run on every PR by gp-webapp.yml's Checks job, and by the PostToolUse hook
// .claude/hooks/feature-map-check.sh when an agent edits the webapp's app/ dir
// or the map itself.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FEATURE_MAP_PATH = 'docs/feature-map.md'
export const NAV_REGISTRY_PATH =
  'packages/gp-webapp/app/dashboard/shared/DashboardMenu.tsx'

const PATH_PREFIXES = ['packages/', 'scripts/', 'docs/', '.github/', '.claude/']

// Same as productMapCoverage.ts: nav entries that are not product areas.
const NOT_A_PRODUCT_AREA = new Set(['nav-log-out'])

// Same floor as productMapCoverage.ts. A scrape below it has stopped reading
// the real registry, and must fail rather than pass with nothing to check.
const MIN_EXPECTED_NAV_IDS = 15

const ROUTE_PARENT_DIRS = [
  'packages/gp-webapp/app/',
  'packages/gp-webapp/app/dashboard/',
]

// Immediate subdirectories of ROUTE_PARENT_DIRS that are not routes. Dirs
// starting with _ (private) or ( (route groups) are skipped as well.
const NOT_A_ROUTE_DIR = new Set(['shared', 'components', 'fonts', 'api'])

// 43 route dirs exist today. Below this, the app dir has moved or the file
// listing is broken, and the coverage check would pass with nothing to check.
const MIN_EXPECTED_ROUTE_DIRS = 30

const STALE_MAP_EXIT_CODE = 2

export interface MapReference {
  line: number
  value: string
}

export interface ParsedFeatureMap {
  paths: MapReference[]
  navIds: MapReference[]
  routeAppDirs: string[]
}

export interface BadPath extends MapReference {
  problem: string
}

export interface FeatureMapCheckResult {
  navIds: string[]
  routeDirs: string[]
  badPaths: BadPath[]
  unmappedNavIds: string[]
  staleNavIds: MapReference[]
  uncoveredRouteDirs: string[]
}

export const parseFeatureMap = (markdown: string): ParsedFeatureMap => {
  const paths: MapReference[] = []
  const navIds: MapReference[] = []
  const routeAppDirs: string[] = []
  markdown.split('\n').forEach((text, index) => {
    const line = index + 1
    const tokens = [...text.matchAll(/`([^`\n]+)`/g)]
      .map((m) => m[1])
      .filter((t): t is string => t !== undefined)
    for (const token of tokens) {
      if (PATH_PREFIXES.some((prefix) => token.startsWith(prefix))) {
        paths.push({ line, value: token })
      }
    }
    if (/^- Nav:/.test(text)) {
      for (const id of tokens) navIds.push({ line, value: id })
    }
    if (/^- Route:/.test(text)) {
      for (const token of tokens) {
        if (token.startsWith('packages/gp-webapp/app/')) {
          routeAppDirs.push(token.endsWith('/') ? token : `${token}/`)
        }
      }
    }
  })
  return { paths, navIds, routeAppDirs }
}

export const readNavIds = (navRegistrySource: string): string[] => {
  const ids = [...navRegistrySource.matchAll(/\bid:\s*'([a-z0-9-]+)'/g)]
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

export const listRouteDirs = (repoFiles: string[]): string[] => {
  const dirs = new Set<string>()
  for (const file of repoFiles) {
    for (const parent of ROUTE_PARENT_DIRS) {
      if (!file.startsWith(parent)) continue
      const segments = file.slice(parent.length).split('/')
      const name = segments[0]
      if (segments.length < 2 || !name) continue
      if (NOT_A_ROUTE_DIR.has(name)) continue
      if (name.startsWith('_') || name.startsWith('(')) continue
      dirs.add(`${parent}${name}/`)
    }
  }
  const routeDirs = [...dirs].sort()
  if (routeDirs.length < MIN_EXPECTED_ROUTE_DIRS) {
    throw new Error(
      `Found only ${routeDirs.length} route dirs under ` +
        `${ROUTE_PARENT_DIRS.join(' and ')}, expected at least ` +
        `${MIN_EXPECTED_ROUTE_DIRS}. The webapp's app dir has probably moved, ` +
        'or the file listing failed. Point this check at the new home rather ' +
        'than lowering the floor.',
    )
  }
  return routeDirs
}

export const checkFeatureMap = ({
  markdown,
  repoFiles,
  navRegistrySource,
}: {
  markdown: string
  repoFiles: string[]
  navRegistrySource: string
}): FeatureMapCheckResult => {
  const parsed = parseFeatureMap(markdown)
  const navIds = readNavIds(navRegistrySource)
  const routeDirs = listRouteDirs(repoFiles)

  const files = new Set(repoFiles)
  const dirs = new Set<string>()
  for (const file of repoFiles) {
    const segments = file.split('/')
    for (let i = 1; i < segments.length; i++) {
      dirs.add(`${segments.slice(0, i).join('/')}/`)
    }
  }

  const badPaths: BadPath[] = []
  for (const ref of parsed.paths) {
    const path = ref.value
    if (/[*{}?]/.test(path)) {
      badPaths.push({
        ...ref,
        problem: 'is a glob. Write out each path it should match.',
      })
    } else if (path.endsWith('/')) {
      if (dirs.has(path)) continue
      badPaths.push({
        ...ref,
        problem: files.has(path.slice(0, -1))
          ? 'is a file, not a directory. Drop the trailing slash.'
          : 'does not exist. Fix the path, or delete the reference if it is gone.',
      })
    } else {
      if (files.has(path)) continue
      badPaths.push({
        ...ref,
        problem: dirs.has(`${path}/`)
          ? 'is a directory. Add a trailing slash.'
          : 'does not exist. Fix the path, or delete the reference if it is gone.',
      })
    }
  }

  const mappedNavIds = new Set(parsed.navIds.map((ref) => ref.value))
  const knownNavIds = new Set(navIds)

  return {
    navIds,
    routeDirs,
    badPaths,
    unmappedNavIds: navIds.filter((id) => !mappedNavIds.has(id)),
    staleNavIds: parsed.navIds.filter((ref) => !knownNavIds.has(ref.value)),
    uncoveredRouteDirs: routeDirs.filter(
      (dir) => !parsed.routeAppDirs.some((appDir) => appDir.startsWith(dir)),
    ),
  }
}

export const formatFeatureMapFailure = (
  result: FeatureMapCheckResult,
): string => {
  const sections: string[][] = []
  if (result.badPaths.length > 0) {
    sections.push([
      `These paths in ${FEATURE_MAP_PATH} are wrong:`,
      ...result.badPaths.map(
        (ref) => `  - line ${ref.line}: \`${ref.value}\` ${ref.problem}`,
      ),
    ])
  }
  if (result.unmappedNavIds.length > 0) {
    sections.push([
      `These dashboard nav ids (from ${NAV_REGISTRY_PATH}) are on no`,
      `"- Nav:" line in ${FEATURE_MAP_PATH}:`,
      ...result.unmappedNavIds.map((id) => `  - ${id}`),
      '',
      'Add each to the "- Nav:" line of the area it opens, or add a new',
      '"## <Area>" section for it.',
    ])
  }
  if (result.staleNavIds.length > 0) {
    sections.push([
      `These "- Nav:" ids in ${FEATURE_MAP_PATH} are no longer in the nav:`,
      ...result.staleNavIds.map((ref) => `  - line ${ref.line}: ${ref.value}`),
      '',
      'Delete them, or replace them with the id that replaced them. Write',
      '"none" if the area no longer has a tab.',
    ])
  }
  if (result.uncoveredRouteDirs.length > 0) {
    sections.push([
      `These webapp route dirs are under no "- Route:" line in ${FEATURE_MAP_PATH}:`,
      ...result.uncoveredRouteDirs.map((dir) => `  - ${dir}`),
      '',
      'Add a "- Route:" line for each to the area it belongs to (or a new',
      '"## <Area>" section), in the form',
      '- Route: `/url/path` -> `packages/gp-webapp/app/<dir>/`',
    ])
  }
  return sections.map((lines) => lines.join('\n')).join('\n\n')
}

const main = () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const mapPath = resolve(repoRoot, FEATURE_MAP_PATH)
  if (!existsSync(mapPath)) {
    throw new Error(`${FEATURE_MAP_PATH} does not exist.`)
  }
  // --others --exclude-standard so a path an agent just created, but has not
  // staged yet, counts. In CI the two listings are the same.
  const repoFiles = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  )
    .split('\n')
    .filter((file) => file.length > 0)

  const result = checkFeatureMap({
    markdown: readFileSync(mapPath, 'utf8'),
    repoFiles,
    navRegistrySource: readFileSync(
      resolve(repoRoot, NAV_REGISTRY_PATH),
      'utf8',
    ),
  })
  const failure = formatFeatureMapFailure(result)

  if (failure) {
    console.error('\nFeature map is out of date.\n')
    console.error(failure)
    console.error('')
    process.exit(STALE_MAP_EXIT_CODE)
  }

  console.log(
    `Feature map covers all ${result.navIds.length} dashboard nav entries ` +
      `and ${result.routeDirs.length} route dirs, and every path in it exists.`,
  )
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    main()
  } catch (error) {
    console.error((error as Error).message)
    process.exit(1)
  }
}
