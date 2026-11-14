import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENTS } from '../agents'
import { AGENT_DIRECTORIES, CODE_MAP, codeMapAgentIds } from './codeMap'

const REPO_ROOT = path.resolve(__dirname, '../../../../../../..')
const GP_API_SRC = 'packages/gp-api/src/'

const ownerOf = (repoPath: string): string | undefined =>
  AGENT_DIRECTORIES.find((dir) => repoPath.startsWith(dir.path))?.agentId

const sourceFilesUnder = (repoDir: string): string[] =>
  readdirSync(path.join(REPO_ROOT, repoDir), {
    recursive: true,
    encoding: 'utf8',
  })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => path.posix.join(repoDir, file))

const IMPORT_FROM = /from '([^']+)'/g

const resolveImport = (importer: string, spec: string): string | undefined =>
  spec.startsWith('.')
    ? path.posix.join(path.posix.dirname(importer), spec)
    : spec.startsWith('@/')
      ? `${GP_API_SRC}${spec.slice(2)}`
      : undefined

describe('the guard code map', () => {
  it('has a row for every agent in the registry', () => {
    const covered = codeMapAgentIds()
    for (const agent of AGENTS) {
      expect(covered.has(agent.agentId), agent.agentId).toBe(true)
    }
  })

  // The regression this guards: an agent added to AGENTS.ts without a
  // matching code-map row would otherwise pass silently, since
  // codeMapAgentIds() only grows. A synthetic, non-redundant map makes the
  // point directly rather than hoping a row in the real map happens to be
  // the only one covering some agent.
  it('fails coverage when an agent has no row at all', () => {
    const covered = codeMapAgentIds(
      [{ path: 'a/', agentIds: ['chief_of_staff'], note: 'x' }],
      ['chief_of_staff', 'campaign_assistant'],
    )
    expect(covered.has('chief_of_staff')).toBe(true)
    expect(covered.has('campaign_assistant')).toBe(false)
  })

  // Delegate review, this story's resume: a row naming literally every
  // registered agent (CODE_MAP's own `llm/` row, correctly, since
  // LlmService is a shared call path) used to make this whole test vacuous —
  // `covered.has(...)` was true for any agent purely because that one
  // catch-all row always lists it, regardless of whether a code-specific row
  // for it exists at all.
  it('does not let a catch-all row alone count as coverage', () => {
    const registry = ['chief_of_staff', 'campaign_assistant']
    const covered = codeMapAgentIds(
      [{ path: 'shared/', agentIds: registry, note: 'catch-all' }],
      registry,
    )
    expect(covered.has('chief_of_staff')).toBe(false)
    expect(covered.has('campaign_assistant')).toBe(false)
  })

  // A coarse row that names more than one agent, but not every registered
  // one, still counts — this is the shape BACKGROUND_AGENT_IDS rows take in
  // the real map, and the fix above must not treat "more than one agent" as
  // the catch-all signal, only "every registered agent".
  it('still counts a coarse row that falls short of every agent', () => {
    const registry = ['chief_of_staff', 'campaign_assistant', 'ordinance_flow']
    const covered = codeMapAgentIds(
      [
        {
          path: 'shared/',
          agentIds: ['chief_of_staff', 'campaign_assistant'],
          note: 'coarse but not total',
        },
      ],
      registry,
    )
    expect(covered.has('chief_of_staff')).toBe(true)
    expect(covered.has('campaign_assistant')).toBe(true)
    expect(covered.has('ordinance_flow')).toBe(false)
  })

  it('every row names a non-empty path and at least one agent', () => {
    for (const row of CODE_MAP) {
      expect(row.path.length).toBeGreaterThan(0)
      expect(row.agentIds.length).toBeGreaterThan(0)
    }
  })

  it('mirrors the chat agent directories in judge-path-floor.sh', () => {
    const script = readFileSync(
      path.join(REPO_ROOT, '.github/scripts/judge-path-floor.sh'),
      'utf8',
    )
    const floorTable = [
      ...script.matchAll(/^\s*(packages\/gp-api\/\S+\/)\*\)\s+add (\w+) ;;$/gm),
    ].map((match) => ({ path: match[1], agentId: match[2] }))
    expect(floorTable.length).toBeGreaterThan(0)
    expect([...AGENT_DIRECTORIES]).toEqual(floorTable)
  })

  // The picker is told a file under an agent directory reaches only that
  // agent unless a row covers it, so an uncovered cross-agent import would
  // make it miss an agent the change really reaches.
  it('covers every import from one agent directory into another', () => {
    const uncovered: string[] = []
    for (const dir of AGENT_DIRECTORIES) {
      for (const importer of sourceFilesUnder(dir.path)) {
        const source = readFileSync(path.join(REPO_ROOT, importer), 'utf8')
        for (const [, spec] of source.matchAll(IMPORT_FROM)) {
          const target = resolveImport(importer, spec ?? '')
          if (target === undefined) continue
          const owner = ownerOf(target)
          if (owner === undefined || owner === dir.agentId) continue
          const covered = CODE_MAP.some(
            (row) =>
              `${target}.ts`.startsWith(row.path) &&
              row.agentIds.includes(owner) &&
              row.agentIds.includes(dir.agentId),
          )
          if (!covered) uncovered.push(`${importer} -> ${target}`)
        }
      }
    }
    expect(uncovered).toEqual([])
  })
})
