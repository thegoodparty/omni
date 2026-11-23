import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CODE_MAP, codeMapSuites } from './codeMap'

const REPO_ROOT = path.resolve(__dirname, '../../../..')

const pairwiseSuites = (): string[] =>
  execFileSync(
    'git',
    [
      'grep',
      '-l',
      'definePairwiseAgentEvalSuite',
      '--',
      'packages/gp-api/src/*.eval.ts',
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
    .split('\n')
    .filter((file) => file.length > 0)
    .map((file) => path.posix.basename(file, '.eval.ts'))

describe('the guard code map', () => {
  it('has a row for every pairwise suite', () => {
    const suites = pairwiseSuites()
    expect(suites.length).toBeGreaterThan(0)
    const covered = codeMapSuites(suites)
    for (const suite of suites) {
      expect(covered.has(suite), suite).toBe(true)
    }
  })

  it('fails coverage when a suite has no row at all', () => {
    const covered = codeMapSuites(
      ['chief_of_staff', 'campaign_assistant'],
      [{ path: 'a/', suites: ['chief_of_staff'], note: 'x' }],
    )
    expect(covered.has('chief_of_staff')).toBe(true)
    expect(covered.has('campaign_assistant')).toBe(false)
  })

  it('does not let a catch-all row alone count as coverage', () => {
    const registry = ['chief_of_staff', 'campaign_assistant']
    const covered = codeMapSuites(registry, [
      { path: 'shared/', suites: registry, note: 'catch-all' },
    ])
    expect(covered.size).toBe(0)
  })

  it('still counts a coarse row that falls short of every suite', () => {
    const covered = codeMapSuites(
      ['chief_of_staff', 'campaign_assistant', 'ordinance_flow'],
      [
        {
          path: 'shared/',
          suites: ['chief_of_staff', 'campaign_assistant'],
          note: 'coarse but not total',
        },
      ],
    )
    expect(covered.has('chief_of_staff')).toBe(true)
    expect(covered.has('ordinance_flow')).toBe(false)
  })

  it('names only suites that have a pairwise eval file', () => {
    const suites = new Set(pairwiseSuites())
    for (const row of CODE_MAP) {
      for (const suite of row.suites) {
        expect(suites.has(suite), `${row.path} -> ${suite}`).toBe(true)
      }
    }
  })

  it('maps the shared directories to the suites they reach', () => {
    const row = (p: string) => CODE_MAP.find((r) => r.path === p)
    const all = new Set(pairwiseSuites())
    expect(new Set(row('packages/judge/src/')?.suites)).toEqual(all)
    expect(new Set(row('packages/gp-api/src/llm/')?.suites)).toEqual(all)
    expect(row('packages/gp-api/src/agents/')?.suites).toContain(
      'meeting_briefing',
    )
    expect(row('packages/gp-api/src/agents/')?.suites).not.toContain(
      'chief_of_staff',
    )
  })

  it('every row names a non-empty path and at least one suite', () => {
    for (const row of CODE_MAP) {
      expect(row.path.length).toBeGreaterThan(0)
      expect(row.suites.length).toBeGreaterThan(0)
    }
  })
})
