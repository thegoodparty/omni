import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TestModule } from 'vitest/node'
import { suiteVerdictAnnotation } from './annotation'
import PairwiseReporter, { collectPairwiseResults } from './reporter'
import { readCaseVerdict, readVerdict } from './stats'

const confirmed = readVerdict({
  cases: [
    readCaseVerdict({
      caseId: 'a1-baseline',
      readings: [
        {
          attempt: 1,
          changes: [
            {
              criterion: 'grounding',
              direction: 'worse',
              evidence: ['base cited a source, candidate did not'],
            },
          ],
          disagreements: [],
        },
        {
          attempt: 2,
          changes: [
            {
              criterion: 'grounding',
              direction: 'worse',
              evidence: ['base cited a source, candidate did not'],
            },
          ],
          disagreements: [],
        },
        { attempt: 3, changes: [], disagreements: ['proportionality'] },
      ],
    }),
    readCaseVerdict({
      caseId: 'a2-thin',
      readings: [
        {
          attempt: 1,
          changes: [
            {
              criterion: 'disclosure',
              direction: 'better',
              evidence: ['base said nothing, candidate named the gap'],
            },
          ],
          disagreements: [],
        },
        { attempt: 2, changes: [], disagreements: [] },
        { attempt: 3, changes: [], disagreements: [] },
      ],
    }),
  ],
  notJudged: 1,
})

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
          reasoning: 'B dropped the source.',
          handledWhen: { base: 'yes', candidate: 'no' },
          changes: [
            {
              criterion: 'grounding',
              better: 'base',
              evidence: 'base cited a source, candidate did not',
            },
          ],
        }),
      },
      {
        type: 'pairwise-order',
        message: JSON.stringify({
          attempt: 1,
          aArm: 'candidate',
          reasoning: 'A dropped the source.',
          handledWhen: { base: 'yes', candidate: 'no' },
          changes: [
            {
              criterion: 'grounding',
              better: 'base',
              evidence: 'base cited a source, candidate did not',
            },
          ],
        }),
      },
      {
        type: 'pairwise-decision',
        message: JSON.stringify({
          attempt: 1,
          changes: [
            {
              criterion: 'grounding',
              direction: 'worse',
              evidence: [
                'base cited a source, candidate did not',
                'base cited a source, candidate did not',
              ],
            },
          ],
          disagreements: [],
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
            pairwiseVerdict: suiteVerdictAnnotation(confirmed),
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
        '| suite &#124; name | WORSE | 6 | 1 | 1 | 0 | 2 | 1 |',
      )
      expect(summary).toContain(
        '| suite &#124; name | a1-baseline | grounding | regression | 2 | base cited a source, candidate did not / base cited a source, candidate did not |',
      )
      expect(summary).toContain(
        '| suite &#124; name | a1-baseline | WORSE | 3 | 0 | 0 | 1 | −grounding |',
      )
      expect(summary).toContain(
        '| suite &#124; name | a2-thin | NO DIFFERENCE FOUND | 3 | 0 | 2 | 0 | none |',
      )
      expect(summary).toContain(
        '| suite &#124; name | a1-baseline | 2 | base | b5474767-7a55-4029-8b43-e720f85e53b8 (superseded) | the run failed: run superseded |',
      )
      expect(write).toHaveBeenCalledWith(summary)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('carries no p-value anywhere in the table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pairwise-reporter-'))
    try {
      vi.stubEnv('GITHUB_STEP_SUMMARY', join(dir, 'summary.md'))
      const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      new PairwiseReporter().onTestRunEnd(modules, [], 'failed')
      const table = String(write.mock.calls[0]?.[0])
      expect(table).not.toMatch(/p[- ]?(better|worse|value|&lt;)/i)
      expect(table).not.toContain('0.015625')
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
      // The guard switches on `label` alone; nothing else may reach it.
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual([
        { suite: 'suite | name', label: 'WORSE' },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps a WORSE verdict when model evidence needs redaction', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pairwise-reporter-'))
    const secret = 'x'.repeat(32)
    const verdict = structuredClone(confirmed)
    verdict.confirmed[0]!.attempts[0]!.evidence = [`a source was missing\n${secret}`]
    const withEvidence = [{
      children: {
        allSuites: () => [{
          fullName: 'grounding suite',
          meta: () => ({ pairwiseVerdict: suiteVerdictAnnotation(verdict) }),
          children: { allTests: () => [] },
        }],
      },
    }] as unknown as TestModule[]
    try {
      const path = join(dir, 'verdicts.json')
      const summaryPath = join(dir, 'summary.md')
      vi.stubEnv('JUDGE_VERDICTS_FILE', path)
      vi.stubEnv('GITHUB_STEP_SUMMARY', summaryPath)
      vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      new PairwiseReporter().onTestRunEnd(withEvidence, [], 'failed')
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual([
        { suite: 'grounding suite', label: 'WORSE' },
      ])
      const summary = readFileSync(summaryPath, 'utf8')
      expect(summary).toContain('a source was missing &#91;redacted&#93;')
      expect(summary).not.toContain(secret)
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
      expect(suite.verdict.confirmed).toEqual([
        {
          caseId: 'a1-baseline',
          criterion: 'grounding',
          direction: 'worse',
          attempts: [
            {
              attempt: 1,
              evidence: ['base cited a source, candidate did not'],
            },
            {
              attempt: 2,
              evidence: ['base cited a source, candidate did not'],
            },
          ],
        },
      ])
      expect(suite.cases).toEqual([
        {
          case: 'a1-baseline',
          attempts: [
            {
              attempt: 1,
              changes: [
                {
                  criterion: 'grounding',
                  direction: 'worse',
                  evidence: [
                    'base cited a source, candidate did not',
                    'base cited a source, candidate did not',
                  ],
                },
              ],
              disagreements: [],
              orders: [
                {
                  aArm: 'base',
                  reasoning: 'B dropped the source.',
                  handledWhen: { base: 'yes', candidate: 'no' },
                  changes: [
                    {
                      criterion: 'grounding',
                      better: 'base',
                      evidence: 'base cited a source, candidate did not',
                    },
                  ],
                },
                {
                  aArm: 'candidate',
                  reasoning: 'A dropped the source.',
                  handledWhen: { base: 'yes', candidate: 'no' },
                  changes: [
                    {
                      criterion: 'grounding',
                      better: 'base',
                      evidence: 'base cited a source, candidate did not',
                    },
                  ],
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
      expect(JSON.stringify(suite)).not.toMatch(/pBetter|pWorse|sign|alpha/)
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
