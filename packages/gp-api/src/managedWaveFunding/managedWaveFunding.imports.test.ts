import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// claimFree makes a send free, so who can reach it is the guard. Anything that
// imports the service or its module could inject it, so the import graph IS
// the access list. Add an importer here only for the wave job, never for a
// controller, a chat tool, or a service a request reaches.
const SRC = join(__dirname, '..')

const ALLOWED_IMPORTERS = new Set([
  'app.module.ts',
  'managedWaveFunding/managedWaveFunding.module.ts',
  'managedWaveFunding/managedWaveFunding.service.test.ts',
  // The wave job, the one caller.
  'managedPanelWaves/managedPanelWaveJob.service.ts',
  'managedPanelWaves/managedPanelWaves.module.ts',
  'outreach/tests/textSendFundingGate.test.ts',
])

const NEVER_IMPORTERS = [
  /\.controller\.ts$/,
  /^chats\//,
  /^llm\//,
  /^mcp\//,
  /tool/i,
]

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'generated' ? [] : sourceFiles(path)
    }
    return entry.name.endsWith('.ts') ? [path] : []
  })

const importsFunding = (source: string): boolean =>
  /from\s+['"][^'"]*managedWaveFunding\/managedWaveFunding\.(service|module)['"]|from\s+['"]\.\/managedWaveFunding\.(service|module)['"]|import\(\s*['"][^'"]*managedWaveFunding\.(service|module)['"]/.test(
    source,
  )

describe('who may import ManagedWaveFundingService', () => {
  const importers = sourceFiles(SRC)
    .filter((path) => importsFunding(readFileSync(path, 'utf8')))
    .map((path) => relative(SRC, path))
    .filter(
      (path) =>
        path !== 'managedWaveFunding/managedWaveFunding.imports.test.ts',
    )

  it('is imported only by the allowed files', () => {
    expect(importers.filter((path) => !ALLOWED_IMPORTERS.has(path))).toEqual([])
  })

  it('is never imported by a controller, chat or tool', () => {
    const allowedButForbidden = [...ALLOWED_IMPORTERS].filter((path) =>
      NEVER_IMPORTERS.some((pattern) => pattern.test(path)),
    )
    expect(allowedButForbidden).toEqual([])
  })

  it('actually finds the importers it guards', () => {
    expect(importers).toContain(
      'managedWaveFunding/managedWaveFunding.module.ts',
    )
  })
})
