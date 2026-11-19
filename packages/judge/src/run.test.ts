import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { runJudge, type RunDeps } from './run'
import { definePairwiseAgentEvalSuite } from './suite'
import type { SuiteResult } from './execute'
import type { GradedPair, Grader, PairRequest } from './grade'
import { verdictFor } from './report'

const suite = definePairwiseAgentEvalSuite<{ topic: string }>('a_suite', {
  mode: 'win',
  profile: {},
  run: async () => 'out',
  cases: [{ id: 'case-1', input: { topic: 't' } }],
})

const pairOf = (
  request: PairRequest,
  winner: GradedPair['winner'],
): GradedPair => ({
  caseId: request.caseId,
  attempt: request.attempt,
  winner,
  orders: [],
  handled: null,
  scores: {},
  usage: { inputTokens: 1, outputTokens: 1 },
})

const resultOf = (winner: GradedPair['winner']): SuiteResult => ({
  suite: 'a_suite',
  mode: 'win',
  profile: {},
  dimensions: [],
  cases: [
    {
      caseId: 'case-1',
      input: { topic: 't' },
      runs: [],
      pairs: [pairOf({ caseId: 'case-1', attempt: 1 } as PairRequest, winner)],
      notJudged: [],
    },
  ],
  usage: { inputTokens: 0, outputTokens: 0 },
})

// Every attempt on both arms threw: nothing reached the grader.
const cannotJudgeResult: SuiteResult = {
  suite: 'a_suite',
  mode: 'win',
  profile: {},
  dimensions: [],
  cases: [
    {
      caseId: 'case-1',
      input: { topic: 't' },
      runs: [],
      pairs: [],
      notJudged: Array.from({ length: 3 }, (_, index) => ({
        caseId: 'case-1',
        attempt: index + 1,
        failedArms: ['base' as const],
      })),
    },
  ],
  usage: { inputTokens: 0, outputTokens: 0 },
}

const argv = (out: string): string[] => [
  '--base',
  'https://base',
  '--candidate',
  'https://candidate',
  '--suite',
  'all',
  '--judge-model',
  'anthropic/claude-sonnet-4-6',
  '--out',
  out,
]

const deps = (
  executeSuiteFn: RunDeps['executeSuiteFn'],
  overrides: Partial<RunDeps> = {},
): RunDeps => ({
  log: () => {},
  probeArmFn: async (baseUrl) => ({ baseUrl, ok: true, detail: 'ok' }),
  resolveJudgeModelFn: () => 'model' as never,
  discoverSuitesFn: async () => [
    { suite: suite as never, file: '/checkout/a.eval.ts' },
  ],
  executeSuiteFn,
  ...overrides,
})

// Where a run writes, per invocation. A default outputRoot is the invocation
// directory, so a test that omits it leaves results/ in the checkout.
let scratch = ''

const depsInto = (
  executeSuiteFn: RunDeps['executeSuiteFn'],
  overrides: Partial<RunDeps> = {},
): RunDeps => deps(executeSuiteFn, { outputRoot: scratch, ...overrides })

describe('runJudge', () => {
  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'judge-checkout-'))
  })
  it('writes both artifacts and exits 0 when nothing got worse', async () => {
    const out = await mkdtemp(join(tmpdir(), 'judge-run-'))
    const code = await runJudge(
      argv('results'),
      deps(async () => resultOf('tie'), { outputRoot: out }),
    )
    expect(code).toBe(0)
    const json = JSON.parse(
      await readFile(join(out, 'results', 'results.json'), 'utf8'),
    )
    expect(json.suites[0].suite).toBe('a_suite')
    expect(json.suites[0].verdict.label).toBe('NO DIFFERENCE FOUND')
    const markdown = await readFile(join(out, 'results', 'results.md'), 'utf8')
    expect(markdown).toContain('# Judge: a_suite')
  })

  it('exits 1 on a WORSE suite', async () => {
    const out = await mkdtemp(join(tmpdir(), 'judge-run-'))
    const worse: SuiteResult = {
      ...resultOf('base'),
      cases: [
        {
          caseId: 'case-1',
          input: {},
          runs: [],
          notJudged: [],
          pairs: Array.from({ length: 6 }, (_, index) =>
            pairOf(
              { caseId: 'case-1', attempt: index + 1 } as PairRequest,
              'base',
            ),
          ),
        },
      ],
    }
    const code = await runJudge(
      argv('results'),
      deps(async () => worse, { outputRoot: out }),
    )
    expect(verdictFor(worse).label).toBe('WORSE')
    expect(code).toBe(1)
  })

  it('exits 2 on a suite it could not judge', async () => {
    const out = await mkdtemp(join(tmpdir(), 'judge-run-'))
    const code = await runJudge(
      argv('results'),
      deps(async () => cannotJudgeResult, { outputRoot: out }),
    )
    expect(code).toBe(2)
    const markdown = await readFile(join(out, 'results', 'results.md'), 'utf8')
    expect(markdown).toContain("## a_suite: CAN'T JUDGE")
  })

  it('exits 1 when one suite is WORSE even if another cannot be judged', async () => {
    // WORSE is read first: a regression someone can act on outranks a suite
    // whose arms never ran.
    const other = definePairwiseAgentEvalSuite<{ topic: string }>('b_suite', {
      mode: 'win',
      profile: {},
      run: async () => 'out',
      cases: [{ id: 'case-2', input: { topic: 't' } }],
    })
    const code = await runJudge(
      argv('results'),
      depsInto(
        async (options) =>
          options.suite.name === 'b_suite'
            ? {
                ...cannotJudgeResult,
                suite: 'b_suite',
                cases: cannotJudgeResult.cases.map((theCase) => ({
                  ...theCase,
                  caseId: 'case-2',
                  notJudged: theCase.notJudged.map((entry) => ({
                    ...entry,
                    caseId: 'case-2',
                  })),
                })),
              }
            : {
                ...resultOf('base'),
                cases: [
                  {
                    caseId: 'case-1',
                    input: {},
                    runs: [],
                    notJudged: [],
                    pairs: Array.from({ length: 6 }, (_, index) =>
                      pairOf(
                        {
                          caseId: 'case-1',
                          attempt: index + 1,
                        } as PairRequest,
                        'base',
                      ),
                    ),
                  },
                ],
              },
        {
          discoverSuitesFn: async () => [
            { suite: suite as never, file: '/a.eval.ts' },
            { suite: other as never, file: '/b.eval.ts' },
          ],
        },
      ),
    )
    expect(code).toBe(1)
  })

  it('exits 2 on an unparseable command line', async () => {
    expect(
      await runJudge(
        ['--nope'],
        depsInto(async () => resultOf('tie')),
      ),
    ).toBe(2)
  })

  it('exits 2 on a judge model the AI SDK cannot resolve', async () => {
    const code = await runJudge(
      argv('results'),
      depsInto(async () => resultOf('tie'), {
        resolveJudgeModelFn: () => {
          throw new Error('bad model id')
        },
      }),
    )
    expect(code).toBe(2)
  })

  it('fails fast, naming the reason, when an arm cannot answer the run routes', async () => {
    let ran = false
    const code = await runJudge(
      argv('results'),
      depsInto(
        async () => {
          ran = true
          return resultOf('tie')
        },
        {
          probeArmFn: async (baseUrl) => ({
            baseUrl,
            ok: baseUrl !== 'https://candidate',
            detail:
              "GET /v1/agents/runs/x answered 404 for a route that does not exist (Cannot GET /v1/agents/runs/x), so this arm's gp-api may not have the run routes deployed",
          }),
        },
      ),
    )
    expect(code).toBe(1)
    expect(ran).toBe(false)
  })

  it('exits 1 without running anything when an arm is unreachable', async () => {
    let ran = false
    const code = await runJudge(
      argv('results'),
      depsInto(
        async () => {
          ran = true
          return resultOf('tie')
        },
        {
          probeArmFn: async (baseUrl) => ({
            baseUrl,
            ok: baseUrl !== 'https://candidate',
            detail: 'connection refused',
          }),
        },
      ),
    )
    expect(code).toBe(1)
    expect(ran).toBe(false)
  })

  it('exits 2 when no suite matches', async () => {
    const code = await runJudge(
      argv('results'),
      depsInto(async () => resultOf('tie'), {
        discoverSuitesFn: async () => {
          throw new Error('no suites')
        },
      }),
    )
    expect(code).toBe(2)
  })

  it('hands every suite to the executor with both arms and the concurrency', async () => {
    const seen: {
      baseUrl: string
      candidateUrl: string
      concurrency: number
    }[] = []
    await runJudge(
      [...argv('results'), '--concurrency', '4'],
      depsInto(async (options) => {
        seen.push({
          baseUrl: options.baseUrl,
          candidateUrl: options.candidateUrl,
          concurrency: options.concurrency,
        })
        const grader: Grader = options.grader
        expect(typeof grader.gradePair).toBe('function')
        return resultOf('tie')
      }),
    )
    expect(seen).toEqual([
      {
        baseUrl: 'https://base',
        candidateUrl: 'https://candidate',
        concurrency: 4,
      },
    ])
  })

  it('judges several suites in one run and exits 1 if any is WORSE', async () => {
    const other = definePairwiseAgentEvalSuite<{ topic: string }>('b_suite', {
      mode: 'win',
      profile: {},
      run: async () => 'out',
      cases: [{ id: 'case-2', input: { topic: 't' } }],
    })
    const code = await runJudge(
      argv('results'),
      depsInto(
        async (options) =>
          options.suite.name === 'b_suite'
            ? {
                ...resultOf('base'),
                suite: 'b_suite',
                cases: [
                  {
                    caseId: 'case-2',
                    input: {},
                    runs: [],
                    notJudged: [],
                    pairs: Array.from({ length: 6 }, (_, index) =>
                      pairOf(
                        { caseId: 'case-2', attempt: index + 1 } as PairRequest,
                        'base',
                      ),
                    ),
                  },
                ],
              }
            : resultOf('tie'),
        {
          discoverSuitesFn: async () => [
            { suite: suite as never, file: '/a.eval.ts' },
            { suite: other as never, file: '/b.eval.ts' },
          ],
        },
      ),
    )
    expect(code).toBe(1)
  })
})
