import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CaseResult, SuiteResult } from './execute'
import {
  countHandling,
  renderMarkdown,
  verdictFor,
  writeResults,
} from './report'
import type { GradedPair } from './grade'

const pair = (
  winner: GradedPair['winner'],
  overrides: Partial<GradedPair> = {},
): GradedPair => ({
  caseId: 'case-0',
  attempt: 1,
  winner,
  orders: [
    {
      aArm: 'base',
      winner,
      reasoning: `because ${winner}`,
      handled: winner === 'candidate' ? { base: 'no', candidate: 'yes' } : null,
      scores: {},
      usage: { inputTokens: 1, outputTokens: 1 },
    },
    {
      aArm: 'candidate',
      winner,
      reasoning: `because ${winner}`,
      handled:
        winner === 'candidate' ? { base: 'yes', candidate: 'yes' } : null,
      scores: {},
      usage: { inputTokens: 1, outputTokens: 1 },
    },
  ],
  // A pair carries a handling reading whenever the case asks for one, whatever
  // the pair's direction, so the test's cases are explicit about it.
  handled: null,
  scores: {},
  usage: { inputTokens: 2, outputTokens: 2 },
  ...overrides,
})

const suiteResultOf = (cases: CaseResult[]): SuiteResult => ({
  suite: 'a_suite',
  mode: 'win',
  profile: {},
  dimensions: [],
  cases,
  usage: { inputTokens: 0, outputTokens: 0 },
})

const armUser = {
  user: {
    id: 1,
    firstName: 'T',
    lastName: 'U',
    email: 'test+clerk_test@test.goodparty.org',
    name: 'T U',
    zip: '82001',
    phone: '2015550100',
    password: 'p',
  },
  orgSlug: 'campaign-1',
  clerkUserId: 'clerk-1',
}

const caseOf = (
  id: string,
  pairs: GradedPair[],
  notJudged: CaseResult['notJudged'] = [],
  attempts = pairs.length,
): CaseResult => ({
  caseId: id,
  input: { topic: id },
  runs: Array.from({ length: attempts }, (_, index) => index + 1).flatMap(
    (attempt) => [
      {
        arm: 'base' as const,
        caseId: id,
        attempt,
        output: 'base output',
        error: null,
        httpStatus: null,
        setupMs: 1,
        runMs: 2,
        user: armUser,
      },
      {
        arm: 'candidate' as const,
        caseId: id,
        attempt,
        output: 'candidate output',
        error: null,
        httpStatus: null,
        setupMs: 1,
        runMs: 2,
        user: armUser,
      },
    ],
  ),
  pairs,
  notJudged,
})

describe('countHandling', () => {
  it('counts only the pairs that carry a handling reading', () => {
    const theCase = caseOf('c', [
      pair('candidate', { handled: { base: false, candidate: true } }),
      pair('tie', { handled: { base: true, candidate: true } }),
      pair('base'),
    ])
    expect(countHandling(theCase)).toEqual({
      basePass: 1,
      candidatePass: 2,
      baseTotal: 2,
      candidateTotal: 2,
    })
  })

  it('counts nothing when no pair was handled', () => {
    expect(countHandling(caseOf('c', [pair('tie')]))).toEqual({
      basePass: 0,
      candidatePass: 0,
      baseTotal: 0,
      candidateTotal: 0,
    })
  })
})

describe('verdictFor', () => {
  it('pools every case into one sign test', () => {
    const result = suiteResultOf([
      caseOf('a', [pair('candidate'), pair('candidate'), pair('candidate')]),
      caseOf('b', [pair('candidate'), pair('candidate'), pair('tie')]),
    ])
    const verdict = verdictFor(result)
    expect(verdict.sign.forCandidate).toBe(5)
    expect(verdict.sign.ties).toBe(1)
    expect(verdict.label).toBe('BETTER')
  })

  it('is WORSE when the base wins enough pairs', () => {
    const result = suiteResultOf([
      caseOf('a', [pair('base'), pair('base'), pair('base')]),
      caseOf('b', [pair('base'), pair('base')]),
    ])
    expect(verdictFor(result).label).toBe('WORSE')
  })
})

const summaryOf = (result: SuiteResult, verdict = verdictFor(result)) => ({
  baseUrl: 'https://base',
  candidateUrl: 'https://candidate',
  judgeModel: 'anthropic/claude-sonnet-4-6',
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:10:00.000Z',
  attemptsPerSide: 3,
  suites: [{ result, verdict }],
})

describe('renderMarkdown', () => {
  it('leads with the verdict and both arms', () => {
    const result = suiteResultOf([caseOf('a', [pair('candidate')])])
    const markdown = renderMarkdown(summaryOf(result))
    expect(markdown).toContain('## a_suite: NO DIFFERENCE FOUND')
    expect(markdown).toContain('https://base')
    expect(markdown).toContain('https://candidate')
  })

  it('lists every case in the per-case table', () => {
    const result = suiteResultOf([
      caseOf('a', [pair('candidate')]),
      caseOf('b', [pair('base')]),
    ])
    const markdown = renderMarkdown(summaryOf(result))
    expect(markdown).toContain('| `a` | 1 | 0 | 0 | 0 | candidate |')
    expect(markdown).toContain('| `b` | 0 | 1 | 0 | 0 | base |')
  })

  it('gives reasoning for every losing pair', () => {
    const result = suiteResultOf([
      caseOf('a', [pair('base'), pair('candidate')]),
    ])
    const markdown = renderMarkdown(summaryOf(result))
    expect(markdown).toContain('Reasoning for every loss')
    expect(markdown).toContain('`a` attempt 1**: because base')
  })

  it('says so when nothing was lost', () => {
    const result = suiteResultOf([caseOf('a', [pair('candidate')])])
    expect(renderMarkdown(summaryOf(result))).toContain('No pair lost.')
  })

  it('marks a tie whose orders disagreed as a disagreement', () => {
    const disagreeing = pair('tie', {
      orders: [
        {
          aArm: 'base',
          winner: 'base',
          reasoning: 'base read better',
          handled: null,
          scores: {},
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        {
          aArm: 'candidate',
          winner: 'candidate',
          reasoning: 'candidate read better',
          handled: null,
          scores: {},
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ],
    })
    // A tie is not a loss, so it never appears in the loss list.
    const markdown = renderMarkdown(
      summaryOf(suiteResultOf([caseOf('a', [disagreeing])])),
    )
    expect(markdown).not.toContain('disagreed')
  })

  it('reports the pass rates and the token totals', () => {
    const result = suiteResultOf([
      caseOf('a', [
        pair('candidate', { handled: { base: false, candidate: true } }),
      ]),
    ])
    const markdown = renderMarkdown(summaryOf(result))
    expect(markdown).toContain('| handledWhen pass, base | 0/1 (0%) |')
    expect(markdown).toContain('| handledWhen pass, candidate | 1/1 (100%) |')
    expect(markdown).toContain('| Judge tokens (in/out) | 0/0 |')
  })

  it('lists the runs that failed', () => {
    const theCase = caseOf('a', [pair('tie')])
    theCase.runs[0]!.error = 'the agent route 500d'
    theCase.runs[0]!.output = null
    const markdown = renderMarkdown(summaryOf(suiteResultOf([theCase])))
    expect(markdown).toContain('Runs that failed')
    expect(markdown).toContain('`a` attempt 1 (base)**: the agent route 500d')
  })

  it('counts the pairs a failed run kept from the grader', () => {
    const theCase = caseOf(
      'a',
      [pair('candidate')],
      [
        { caseId: 'a', attempt: 2, failedArms: ['base'] },
        { caseId: 'a', attempt: 3, failedArms: ['base'] },
      ],
    )
    const markdown = renderMarkdown(summaryOf(suiteResultOf([theCase])))
    expect(markdown).toContain('| Pairs not judged | 2 |')
    expect(markdown).toContain('| `a` | 1 | 0 | 0 | 2 | candidate |')
  })

  it('says which arm failed, and how often, on a suite it could not judge', () => {
    const theCase = caseOf(
      'a',
      [],
      [
        { caseId: 'a', attempt: 1, failedArms: ['base'] },
        { caseId: 'a', attempt: 2, failedArms: ['base'] },
        { caseId: 'a', attempt: 3, failedArms: ['base'] },
      ],
      3,
    )
    for (const run of theCase.runs.filter((run) => run.arm === 'base')) {
      run.output = null
      run.error = 'Request failed with status code 404'
      run.httpStatus = 404
    }
    const markdown = renderMarkdown(summaryOf(suiteResultOf([theCase])))
    expect(markdown).toContain("## a_suite: CAN'T JUDGE")
    expect(markdown).toContain('| Pairs not judged | 3 |')
    expect(markdown).toContain('| Failed runs, base / candidate | 3 / 0 |')
    expect(markdown).toContain('| `a` | 0 | 0 | 0 | 3 | not judged |')
  })

  it('names an arm whose every run failed the same way, at the top', () => {
    const theCase = caseOf('a', [], [], 3)
    for (const run of theCase.runs) {
      run.error = 'Request failed with status code 404'
      run.output = null
      run.httpStatus = 404
    }
    const markdown = renderMarkdown(summaryOf(suiteResultOf([theCase])))
    const [first, second, third] = markdown.split('\n')
    expect(first).toBe('# Judge: a_suite')
    expect(second).toBe('')
    expect(third).toBe(
      'Every base run failed with 404: the base gp-api may not have the run routes deployed.',
    )
    expect(markdown).toContain(
      'Every candidate run failed with 404: the candidate gp-api may not have the run routes deployed.',
    )
  })

  it('says nothing at the top when one arm had a run succeed', () => {
    const theCase = caseOf('a', [], [], 3)
    const failed = theCase.runs.filter((run) => run.arm === 'base').slice(0, 2)
    for (const run of failed) {
      run.error = 'Request failed with status code 404'
      run.output = null
      run.httpStatus = 404
    }
    const markdown = renderMarkdown(summaryOf(suiteResultOf([theCase])))
    expect(markdown).not.toContain('Every base run failed')
  })

  it('says nothing at the top when the arm failed in more than one way', () => {
    const theCase = caseOf('a', [], [], 3)
    const baseRuns = theCase.runs.filter((run) => run.arm === 'base')
    for (const [index, run] of baseRuns.entries()) {
      run.output = null
      run.httpStatus = index === 0 ? 500 : 404
      run.error = `Request failed with status code ${run.httpStatus}`
    }
    const markdown = renderMarkdown(summaryOf(suiteResultOf([theCase])))
    expect(markdown).not.toContain('Every base run failed')
  })

  it('says nothing at the top when a failed run died without a status', () => {
    const theCase = caseOf('a', [], [], 3)
    for (const run of theCase.runs) {
      run.error = 'still running after 3600000ms'
      run.output = null
      run.httpStatus = null
    }
    const markdown = renderMarkdown(summaryOf(suiteResultOf([theCase])))
    expect(markdown).not.toContain('Every base run failed')
  })
})

describe('writeResults', () => {
  it('writes results.json with every output and judgment', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'judge-report-'))
    const result = suiteResultOf([caseOf('a', [pair('candidate')])])
    const summary = summaryOf(result)
    const { jsonPath, markdownPath } = await writeResults(outDir, summary)
    const json = JSON.parse(await readFile(jsonPath, 'utf8'))
    expect(json.baseUrl).toBe('https://base')
    expect(json.suites[0].cases[0].runs[0].output).toBe('base output')
    expect(json.suites[0].cases[0].notJudged).toEqual([])
    expect(json.suites[0].cases[0].pairs[0].winner).toBe('candidate')
    expect(json.suites[0].verdict.label).toBeDefined()
    const markdown = await readFile(markdownPath, 'utf8')
    expect(markdown).toContain('# Judge: a_suite')
  })
})
