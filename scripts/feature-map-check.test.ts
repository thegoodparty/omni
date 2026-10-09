import { describe, expect, it } from 'vitest'
import {
  checkFeatureMap,
  formatFeatureMapFailure,
  listRouteDirs,
  parseFeatureMap,
  readNavIds,
} from './feature-map-check'

const NAV_IDS = Array.from({ length: 16 }, (_, i) => `nav-area-${i}`)

const navRegistrySource = [
  ...NAV_IDS.map((id) => `  { id: '${id}', label: 'x' },`),
  `  { id: 'nav-log-out', label: 'Log out' },`,
].join('\n')

const DASHBOARD_ROUTE_DIRS = Array.from({ length: 30 }, (_, i) => `area${i}`)

const repoFiles = [
  'packages/gp-webapp/app/page.tsx',
  'packages/gp-webapp/app/api/health/route.ts',
  'packages/gp-webapp/app/fonts/font.woff',
  'packages/gp-webapp/app/shared/Thing.tsx',
  'packages/gp-webapp/app/_private/x.ts',
  'packages/gp-webapp/app/(group)/page.tsx',
  'packages/gp-webapp/app/login/page.tsx',
  'packages/gp-webapp/app/dashboard/page.tsx',
  'packages/gp-webapp/app/dashboard/components/Card.tsx',
  'packages/gp-webapp/app/dashboard/shared/DashboardMenu.tsx',
  ...DASHBOARD_ROUTE_DIRS.map(
    (dir) => `packages/gp-webapp/app/dashboard/${dir}/page.tsx`,
  ),
  'packages/gp-api/src/contacts/contacts.controller.ts',
  'packages/gp-api/AGENTS.md',
  'docs/testing.md',
]

const area = (i: number) =>
  [
    `## Area ${i}`,
    '',
    `- Nav: \`nav-area-${i}\``,
    '- Modes: both',
    `- Route: \`/dashboard/area${i}\` -> \`packages/gp-webapp/app/dashboard/area${i}/\``,
    '- API: `packages/gp-api/src/contacts/` (`GET /v1/contacts`)',
    '',
  ].join('\n')

const validMap = [
  ...NAV_IDS.map((_, i) => area(i)),
  ...DASHBOARD_ROUTE_DIRS.slice(NAV_IDS.length).map((_, i) =>
    area(i + NAV_IDS.length).replace(/- Nav: .*/, '- Nav: none'),
  ),
  '## Login',
  '',
  '- Nav: none',
  '- Route: `/login` -> `packages/gp-webapp/app/login/`',
  '- Route: `/dashboard` -> `packages/gp-webapp/app/dashboard/`',
  '- Docs: `packages/gp-api/AGENTS.md`',
  '- Notes: see `docs/testing.md` and `GET /v1/not-a-path`',
].join('\n')

const check = (markdown: string) =>
  checkFeatureMap({ markdown, repoFiles, navRegistrySource })

describe('parseFeatureMap', () => {
  it('collects repo paths, nav ids, and route app dirs with line numbers', () => {
    const parsed = parseFeatureMap(
      [
        '## Contacts',
        '- Nav: `nav-contacts`, `nav-lists`',
        '- Route: `/dashboard/contacts` -> `packages/gp-webapp/app/dashboard/contacts`',
        '- API: `packages/gp-api/src/contacts/` (`GET /v1/contacts`)',
        '- Notes: `.claude/hooks/x.sh` and `src/not-a-repo-path.ts`',
      ].join('\n'),
    )
    expect(parsed.navIds).toEqual([
      { line: 2, value: 'nav-contacts' },
      { line: 2, value: 'nav-lists' },
    ])
    expect(parsed.routeAppDirs).toEqual([
      'packages/gp-webapp/app/dashboard/contacts/',
    ])
    expect(parsed.paths).toEqual([
      { line: 3, value: 'packages/gp-webapp/app/dashboard/contacts' },
      { line: 4, value: 'packages/gp-api/src/contacts/' },
      { line: 5, value: '.claude/hooks/x.sh' },
    ])
  })

  it('reads "none" on a Nav line as no ids', () => {
    expect(parseFeatureMap('- Nav: none').navIds).toEqual([])
  })
})

describe('readNavIds', () => {
  it('drops nav-log-out', () => {
    expect(readNavIds(navRegistrySource)).toEqual(NAV_IDS)
  })

  it('throws when the scrape falls below the floor', () => {
    expect(() => readNavIds(`{ id: 'nav-a' }`)).toThrow(/expected at least/)
  })
})

describe('listRouteDirs', () => {
  it('lists immediate route dirs, skipping the explicit excludes, _ and ( dirs', () => {
    const dirs = listRouteDirs(repoFiles)
    expect(dirs).toContain('packages/gp-webapp/app/login/')
    expect(dirs).toContain('packages/gp-webapp/app/dashboard/')
    expect(dirs).toContain('packages/gp-webapp/app/dashboard/area0/')
    expect(dirs).not.toContain('packages/gp-webapp/app/api/')
    expect(dirs).not.toContain('packages/gp-webapp/app/fonts/')
    expect(dirs).not.toContain('packages/gp-webapp/app/shared/')
    expect(dirs).not.toContain('packages/gp-webapp/app/_private/')
    expect(dirs).not.toContain('packages/gp-webapp/app/(group)/')
    expect(dirs).not.toContain('packages/gp-webapp/app/dashboard/components/')
    expect(dirs).not.toContain('packages/gp-webapp/app/dashboard/shared/')
    expect(dirs).toHaveLength(DASHBOARD_ROUTE_DIRS.length + 2)
  })

  it('throws when the listing falls below the floor', () => {
    expect(() =>
      listRouteDirs(['packages/gp-webapp/app/login/page.tsx']),
    ).toThrow(/expected at least/)
  })
})

describe('checkFeatureMap', () => {
  it('passes a map that covers everything with real paths', () => {
    const result = check(validMap)
    expect(formatFeatureMapFailure(result)).toBe('')
  })

  it('flags missing paths, globs, and wrong trailing slashes', () => {
    const result = check(
      [
        validMap,
        '- Docs: `packages/gp-api/src/gone/`',
        '- Docs: `packages/gp-api/{a,b}.ts`',
        '- Docs: `packages/gp-api/src/contacts`',
        '- Docs: `packages/gp-api/AGENTS.md/`',
      ].join('\n'),
    )
    expect(result.badPaths.map((ref) => [ref.value, ref.problem])).toEqual([
      ['packages/gp-api/src/gone/', expect.stringMatching(/does not exist/)],
      ['packages/gp-api/{a,b}.ts', expect.stringMatching(/glob/)],
      [
        'packages/gp-api/src/contacts',
        expect.stringMatching(/Add a trailing slash/),
      ],
      [
        'packages/gp-api/AGENTS.md/',
        expect.stringMatching(/Drop the trailing slash/),
      ],
    ])
  })

  it('flags nav ids missing from the map and map ids missing from the nav', () => {
    const result = check(
      validMap
        .replace('- Nav: `nav-area-3`', '- Nav: none')
        .replace('- Nav: `nav-area-4`', '- Nav: `nav-area-4`, `nav-retired`'),
    )
    expect(result.unmappedNavIds).toEqual(['nav-area-3'])
    expect(result.staleNavIds.map((ref) => ref.value)).toEqual(['nav-retired'])
  })

  it('flags route dirs no Route line covers', () => {
    const result = check(
      validMap.replace(
        '- Route: `/login` -> `packages/gp-webapp/app/login/`',
        '- Notes: login lives at `packages/gp-webapp/app/login/`',
      ),
    )
    expect(result.uncoveredRouteDirs).toEqual(['packages/gp-webapp/app/login/'])
  })

  it('counts a deeper Route path as covering its top-level dir', () => {
    const result = check(
      validMap.replace(
        '`packages/gp-webapp/app/dashboard/area0/`',
        '`packages/gp-webapp/app/dashboard/area0/page.tsx`',
      ),
    )
    expect(result.uncoveredRouteDirs).toEqual([])
  })
})

describe('formatFeatureMapFailure', () => {
  it('names each problem with its line and the fix', () => {
    const failure = formatFeatureMapFailure(
      check(
        [
          validMap.replace('- Nav: `nav-area-3`', '- Nav: `nav-retired`'),
          '- Docs: `docs/gone.md`',
        ].join('\n'),
      ),
    )
    expect(failure).toMatch(/line \d+: `docs\/gone.md` does not exist/)
    expect(failure).toMatch(/nav-area-3/)
    expect(failure).toMatch(/line \d+: nav-retired/)
    expect(failure).toMatch(/Add each to the "- Nav:" line/)
  })
})
