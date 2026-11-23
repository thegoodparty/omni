import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TestModule } from 'vitest/node'
import { suiteVerdictAnnotation } from './annotation'
import PairwiseReporter, { collectPairwiseResults } from './reporter'

const cases = [
  {
    name: 'a1-baseline',
    annotations: () => [
      {
        type: 'pairwise-run',
        message: '{"arm":"base","attempt":1}',
      },
      {
        type: 'pairwise-order',
        message: JSON.stringify({
          attempt: 1,
          aArm: 'base',
          winner: 'candidate',
          reasoning: 'B answered the question.',
          handledWhen: { base: 'no', candidate: 'yes' },
          scores: { task_success: { base: 2, candidate: 4 } },
        }),
      },
      {
        type: 'pairwise-order',
        message: JSON.stringify({
          attempt: 1,
          aArm: 'candidate',
          winner: 'candidate',
          reasoning: 'A answered the question.',
          handledWhen: { base: 'no', candidate: 'yes' },
          scores: { task_success: { base: 2, candidate: 4 } },
        }),
      },
      {
        type: 'pairwise-decision',
        message: JSON.stringify({
          attempt: 1,
          winner: 'candidate',
          ordersAgree: true,
        }),
      },
    ],
  },
]

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
            pairwiseNotJudged: suiteVerdictAnnotation([
              {
                caseId: 'a1-baseline',
                attempt: 2,
                side: 'base',
                runs: [
                  {
                    runId: 'b5474767-7a55-4029-8b43-e720f85e53b8',
                    status: 'superseded',
                  },
                ],
                error: 'the run failed: run superseded',
              },
            ]),
          }),
          children: { allTests: () => cases },
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
      const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      new PairwiseReporter().onTestRunEnd(modules, [], 'failed')
      const summary = readFileSync(path, 'utf8')
      expect(summary).toContain(
        '| suite &#124; name | WORSE | 6 | 0 | 0 | 0 | 1.000 | 0.016 | 0/0 | 0/0 | 1.000 |',
      )
      expect(summary).toContain(
        '| suite &#124; name | a1-baseline | 2 | base | b5474767-7a55-4029-8b43-e720f85e53b8 (superseded) | the run failed: run superseded |',
      )
      expect(write).toHaveBeenCalledWith(summary)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes each suite and its verdict label to JUDGE_VERDICTS_FILE', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pairwise-reporter-'))
    try {
      const path = join(dir, 'verdicts.json')
      vi.stubEnv('JUDGE_VERDICTS_FILE', path)
      vi.stubEnv('GITHUB_STEP_SUMMARY', join(dir, 'summary.md'))
      new PairwiseReporter().onTestRunEnd(modules, [], 'failed')
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual([
        { suite: 'suite | name', label: 'WORSE' },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("writes every attempt's orders and reasoning to JUDGE_RESULTS_FILE", () => {
    const dir = mkdtempSync(join(tmpdir(), 'pairwise-reporter-'))
    try {
      const path = join(dir, 'results.json')
      vi.stubEnv('JUDGE_RESULTS_FILE', path)
      vi.stubEnv('GITHUB_STEP_SUMMARY', join(dir, 'summary.md'))
      vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      new PairwiseReporter().onTestRunEnd(modules, [], 'failed')
      const [suite] = JSON.parse(readFileSync(path, 'utf8'))
      expect(suite.verdict.label).toBe('WORSE')
      expect(suite.verdict.sign.pWorse).toBe(0.015625)
      expect(suite.cases).toEqual([
        {
          case: 'a1-baseline',
          attempts: [
            {
              attempt: 1,
              winner: 'candidate',
              ordersAgree: true,
              orders: [
                {
                  aArm: 'base',
                  winner: 'candidate',
                  reasoning: 'B answered the question.',
                  handledWhen: { base: 'no', candidate: 'yes' },
                },
                {
                  aArm: 'candidate',
                  winner: 'candidate',
                  reasoning: 'A answered the question.',
                  handledWhen: { base: 'no', candidate: 'yes' },
                },
              ],
            },
          ],
        },
      ])
      expect(suite.notJudged).toEqual([
        {
          caseId: 'a1-baseline',
          attempt: 2,
          side: 'base',
          runs: [
            {
              runId: 'b5474767-7a55-4029-8b43-e720f85e53b8',
              status: 'superseded',
            },
          ],
          error: 'the run failed: run superseded',
        },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("keeps the verdict table when a suite's not-judged list is unreadable", () => {
    vi.stubEnv('GITHUB_STEP_SUMMARY', undefined)
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const [suite] = [...modules[0]!.children.allSuites()] as unknown as {
      fullName: string
      meta: () => object
      children: object
    }[]
    const broken = [
      {
        children: {
          allSuites: () => [
            {
              fullName: suite!.fullName,
              meta: () => ({
                ...suite!.meta(),
                pairwiseNotJudged: {
                  type: 'pairwise-not-judged',
                  message: '{',
                },
              }),
              children: suite!.children,
            },
          ],
        },
      },
    ] as unknown as TestModule[]
    new PairwiseReporter().onTestRunEnd(broken, [], 'failed')
    const table = String(write.mock.calls[0]?.[0])
    expect(table).toContain('| suite &#124; name | WORSE |')
    expect(table).toContain('unreadable: SyntaxError')
    expect(collectPairwiseResults(broken)[0]?.notJudged).toEqual([])
  })

  it('neutralises mentions, links and references in a not-judged error', () => {
    vi.stubEnv('GITHUB_STEP_SUMMARY', undefined)
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const [suite] = [...modules[0]!.children.allSuites()] as unknown as {
      fullName: string
      meta: () => object
      children: object
    }[]
    const hostile = [
      {
        children: {
          allSuites: () => [
            {
              fullName: suite!.fullName,
              meta: () => ({
                ...suite!.meta(),
                pairwiseNotJudged: suiteVerdictAnnotation([
                  {
                    caseId: 'a1-baseline',
                    attempt: 1,
                    side: 'base',
                    runs: [],
                    error:
                      '@octocat see https://example.test/x and #123 `code` and www.example.test',
                  },
                ]),
              }),
              children: suite!.children,
            },
          ],
        },
      },
    ] as unknown as TestModule[]
    new PairwiseReporter().onTestRunEnd(hostile, [], 'failed')
    const table = String(write.mock.calls[0]?.[0])
    expect(table).toContain(
      '&#64;octocat see https:&#47;&#47;example.test/x and &#35;123 &#96;code&#96; and www&#46;example.test',
    )
    expect(table).not.toContain('@octocat')
    expect(table).not.toContain('www.example.test')
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
