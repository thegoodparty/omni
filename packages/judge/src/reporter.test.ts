import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TestModule } from 'vitest/node'
import { suiteVerdictAnnotation } from './annotation'
import PairwiseReporter from './reporter'

const modules = [
  {
    children: {
      allSuites: () => [
        {
          fullName: 'suite | name',
          meta: () => ({
            pairwiseVerdict: suiteVerdictAnnotation({
              label: 'WORSE',
              sign: {
                forBase: 6,
                forCandidate: 0,
                ties: 0,
                pBetter: 1,
                pWorse: 0.015625,
              },
              handled: {
                basePass: 0,
                baseTotal: 0,
                candidatePass: 0,
                candidateTotal: 0,
                pWorse: 1,
              },
              notJudged: 0,
            }),
          }),
        },
      ],
    },
  },
] as unknown as TestModule[]

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('PairwiseReporter', () => {
  it('appends the verdict table to the GitHub step summary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pairwise-reporter-'))
    try {
      const path = join(dir, 'summary.md')
      vi.stubEnv('GITHUB_STEP_SUMMARY', path)
      new PairwiseReporter().onTestRunEnd(modules, [], 'failed')
      expect(readFileSync(path, 'utf8')).toContain(
        '| suite &#124; name | WORSE | 6 | 0 | 0 | 0 | 1.000 | 0.016 | 0/0 | 0/0 | 1.000 |',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes to stdout locally and stays quiet without verdicts', () => {
    vi.stubEnv('GITHUB_STEP_SUMMARY', undefined)
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    new PairwiseReporter().onTestRunEnd([], [], 'passed')
    expect(write).not.toHaveBeenCalled()
    new PairwiseReporter().onTestRunEnd(modules, [], 'failed')
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining('Pairwise eval verdicts'),
    )
  })
})
