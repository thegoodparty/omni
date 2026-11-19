import type { TestContext } from 'vitest'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { z } from 'zod'
import {
  ATTEMPTS_PER_CASE,
  annotateWith,
  defineExpectedResultEvalSuite,
  registerSuite,
  vitestGlobals,
  type ExpectedResultEvalSuite,
  type VitestGlobals,
} from './expectedResult'
import { createJudgeModel, type JudgeGenerateObjectFn } from './judgeModel'

// Fake `describe`/`it`: they collect what the helper registers instead of
// running anything, so a test drives one case's callback itself.
const fakeVitest = () => {
  const tests: { id: string; run: (context: TestContext) => Promise<void> }[] =
    []
  const suites: string[] = []
  const it = {
    concurrent: (id: string, run: (context: TestContext) => Promise<void>) => {
      tests.push({ id, run })
    },
  } as unknown as VitestGlobals['it']
  const describeFn = ((name: string, body: () => void) => {
    suites.push(name)
    body()
  }) as unknown as VitestGlobals['describe']
  return { globals: { describe: describeFn, it }, tests, suites }
}

// A test's `annotate` and `expect`, recording rather than throwing, so a
// failure is readable as "which attempt disagreed".
const recordingContext = () => {
  const annotations: { message: string; type: string }[] = []
  const failures: string[] = []
  const context = {
    annotate: async (message: string, type: string) => {
      annotations.push({ message, type })
      return { message, type }
    },
    expect: ((actual: unknown, message?: string) => ({
      toEqual: (expected: unknown) => {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          failures.push(`${message}: ${JSON.stringify(actual)}`)
        }
      },
    })) as unknown as TestContext['expect'],
  } as TestContext
  return { context, annotations, failures }
}

const modelAnswering =
  (answer: unknown): JudgeGenerateObjectFn =>
  async () => ({ object: answer, usage: { inputTokens: 1, outputTokens: 1 } })

const judgeModelWith = (generateObjectFn: JudgeGenerateObjectFn) =>
  createJudgeModel({
    env: { JUDGE_MODEL: 'anthropic/claude-sonnet-5-5' },
    resolveModel: () => 'judge-model',
    generateObjectFn,
  })

describe('defineExpectedResultEvalSuite', () => {
  it('refuses a suite with no name, no cases, or a duplicate id', () => {
    const run = async () => 'out'
    const judge = async () => ({ passed: true })
    expect(() =>
      defineExpectedResultEvalSuite('', {
        run,
        judge,
        cases: [{ id: 'a', input: {}, expected: { passed: true } }],
      }),
    ).toThrow(/needs a name/)
    expect(() =>
      defineExpectedResultEvalSuite('empty', { run, judge, cases: [] }),
    ).toThrow(/has no cases/)
    expect(() =>
      defineExpectedResultEvalSuite('dupes', {
        run,
        judge,
        cases: [
          { id: 'a', input: {}, expected: { passed: true } },
          { id: 'a', input: {}, expected: { passed: true } },
        ],
      }),
    ).toThrow(/two cases with id 'a'/)
  })

  it('returns the suite and registers nothing outside Vitest', () => {
    expect(vitestGlobals()).toBeUndefined()
    const suite = defineExpectedResultEvalSuite('outside-vitest', {
      run: async () => 'out',
      judge: async () => ({ passed: true }),
      cases: [{ id: 'a', input: {}, expected: { passed: true } }],
    })
    expect(suite.name).toBe('outside-vitest')
    expect(suite.isExpectedResultEvalSuite).toBe(true)
  })

  it('infers Input from run and Judgment from judge, so a mismatched case fails to compile', () => {
    type Input = { draft: string }
    type Judgment = { passed: boolean; reason: string }
    const build = (
      cases: { id: string; input: Input; expected: Judgment }[],
    ): ExpectedResultEvalSuite<Input, string, Judgment> =>
      defineExpectedResultEvalSuite('inferred', {
        run: async (input: Input) => input.draft,
        judge: async (output: string) => ({
          passed: output.length > 0,
          reason: output,
        }),
        cases,
      })
    const suite = build([
      {
        id: 'a',
        input: { draft: 'x' },
        expected: { passed: true, reason: 'x' },
      },
    ])
    expectTypeOf(suite.cases[0]!.input).toEqualTypeOf<Input>()
    expectTypeOf(suite.cases[0]!.expected).toEqualTypeOf<Judgment>()
    // The two calls below are the type-level assertion: `tsc` fails on this
    // file if either `@ts-expect-error` stops being an error.
    build([
      {
        id: 'b',
        // @ts-expect-error -- a case's input is the run's own input type
        input: { notADraft: 1 },
        expected: { passed: true, reason: 'x' },
      },
    ])
    build([
      {
        id: 'c',
        input: { draft: 'x' },
        // @ts-expect-error -- a case's expected is the judge's return type
        expected: { passed: 'yes' },
      },
    ])
  })
})

describe('registerSuite', () => {
  it('registers one concurrent test per case under the suite name', () => {
    const { globals, tests, suites } = fakeVitest()
    registerSuite(
      {
        name: 'gate',
        isExpectedResultEvalSuite: true,
        run: async () => 'out',
        judge: async () => ({ passed: true }),
        cases: [
          { id: 'clean', input: {}, expected: { passed: true } },
          { id: 'leak', input: {}, expected: { passed: false } },
        ],
      },
      globals,
      judgeModelWith(modelAnswering('clean')),
    )
    expect(suites).toEqual(['gate'])
    expect(tests.map(({ id }) => id)).toEqual(['clean', 'leak'])
  })

  it('runs every attempt and passes when each one reproduces the expected', async () => {
    const { globals, tests } = fakeVitest()
    const run = vi.fn(async () => 'out')
    registerSuite(
      {
        name: 'gate',
        isExpectedResultEvalSuite: true,
        run,
        judge: async () => ({ passed: true }),
        cases: [{ id: 'clean', input: {}, expected: { passed: true } }],
      },
      globals,
      judgeModelWith(modelAnswering('clean')),
    )
    const { context, failures } = recordingContext()
    await tests[0]!.run(context)
    expect(run).toHaveBeenCalledTimes(ATTEMPTS_PER_CASE)
    expect(failures).toEqual([])
  })

  it('fails the case when any attempt disagrees, naming the attempt', async () => {
    const { globals, tests } = fakeVitest()
    let attempt = 0
    registerSuite(
      {
        name: 'gate',
        isExpectedResultEvalSuite: true,
        run: async () => 'out',
        judge: async () => ({ passed: ++attempt !== 2 }),
        cases: [{ id: 'clean', input: {}, expected: { passed: true } }],
      },
      globals,
      judgeModelWith(modelAnswering('clean')),
    )
    const { context, failures, annotations } = recordingContext()
    await tests[0]!.run(context)
    expect(failures).toEqual(['attempt 2: {"passed":false}'])
    expect(annotations.some(({ type }) => type === 'expected-vs-actual')).toBe(
      true,
    )
  })

  it('records every step of an attempt: run step, attempt, output, prompt, answer, judgment', async () => {
    const { globals, tests } = fakeVitest()
    registerSuite(
      {
        name: 'gate',
        isExpectedResultEvalSuite: true,
        run: async (input: string, ctx) => {
          await ctx.annotate(`step for ${input}`, 'step')
          return `ran ${input}`
        },
        judge: async (output, ctx) => ({
          passed:
            (
              await ctx.judgeModel(
                z.object({ answer: z.string() }),
                `Is this clean? ${output}`,
              )
            ).answer === 'clean',
        }),
        cases: [{ id: 'clean', input: 'draft', expected: { passed: true } }],
      },
      globals,
      judgeModelWith(modelAnswering({ answer: 'clean' })),
    )
    const { context, annotations, failures } = recordingContext()
    await tests[0]!.run(context)
    expect(failures).toEqual([])
    const types = new Set(annotations.map(({ type }) => type))
    for (const type of [
      'step',
      'attempt',
      'run-output',
      'judge-prompt',
      'judge-answer',
      'judgment',
    ]) {
      expect(types).toContain(type)
    }
    expect(annotations.filter(({ type }) => type === 'attempt')).toHaveLength(
      ATTEMPTS_PER_CASE,
    )
  })

  it('truncates a long run output in the record', async () => {
    const { globals, tests } = fakeVitest()
    registerSuite(
      {
        name: 'long',
        isExpectedResultEvalSuite: true,
        run: async () => 'a long answer. '.repeat(1_000),
        judge: async () => ({ passed: true }),
        cases: [{ id: 'long', input: {}, expected: { passed: true } }],
      },
      globals,
      judgeModelWith(modelAnswering('clean')),
    )
    const { context, annotations } = recordingContext()
    await tests[0]!.run(context)
    const output = annotations.find(({ type }) => type === 'run-output')!
    expect(output.message.length).toBeLessThan(5_000)
    expect(output.message).toContain('more characters')
  })

  it('runs a suite that never calls judgeModel with no JUDGE_MODEL set', async () => {
    const { globals, tests } = fakeVitest()
    registerSuite(
      {
        name: 'deterministic',
        isExpectedResultEvalSuite: true,
        run: async () => 'out',
        judge: async () => ({ passed: true }),
        cases: [{ id: 'clean', input: {}, expected: { passed: true } }],
      },
      globals,
      createJudgeModel({ env: {} }),
    )
    const { context, failures } = recordingContext()
    await tests[0]!.run(context)
    expect(failures).toEqual([])
  })

  it('fails the test with a sentence naming JUDGE_MODEL when it is unset', async () => {
    const { globals, tests } = fakeVitest()
    registerSuite(
      {
        name: 'needs-model',
        isExpectedResultEvalSuite: true,
        run: async () => 'out',
        judge: async (_output, ctx) => {
          await ctx.judgeModel(z.object({}), 'prompt')
          return { passed: true }
        },
        cases: [{ id: 'clean', input: {}, expected: { passed: true } }],
      },
      globals,
      createJudgeModel({ env: {} }),
    )
    const { context } = recordingContext()
    await expect(tests[0]!.run(context)).rejects.toThrow(/JUDGE_MODEL is not/)
  })
})

describe('annotateWith', () => {
  it('redacts a token-shaped string before it reaches the report', async () => {
    const { context, annotations } = recordingContext()
    await annotateWith(context)('token mt_abcdefghijklmnop', 'step')
    expect(annotations[0]!.message).toBe('token [redacted]')
  })

  // A test user's token, a Clerk key, a model key and a Vercel bypass secret
  // are the four things that must never reach a report. This drives one full
  // case with all four in flight and scans everything it recorded.
  it('leaves no token-shaped string in any annotation a whole case records', async () => {
    const tokens = [
      'mt_abcdefghijklmnopqrstuvwxyz',
      'sk_test_abcdefghijklmnopqrstuvwxyz',
      'sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl',
      'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    ]
    const { globals, tests } = fakeVitest()
    registerSuite(
      {
        name: 'leaky',
        isExpectedResultEvalSuite: true,
        run: async (_input, ctx) => {
          await ctx.annotate(`user token ${tokens[0]}`, 'step')
          return { body: tokens.join(' ') }
        },
        judge: async (_output, ctx) => ({
          answer: (
            await ctx.judgeModel(
              z.object({ answer: z.string() }),
              `Judge with ${tokens[2]}`,
            )
          ).answer,
        }),
        cases: [{ id: 'leaky', input: {}, expected: { answer: 'x' } }],
      },
      globals,
      judgeModelWith(modelAnswering({ answer: tokens[1] })),
    )
    const { context, annotations } = recordingContext()
    // The case fails on the mismatch, which is what makes it record the
    // expected-vs-actual annotation too.
    await tests[0]!.run(context).catch(() => undefined)
    expect(annotations.length).toBeGreaterThan(0)
    for (const { message } of annotations) {
      for (const token of tokens) expect(message).not.toContain(token)
    }
  })
})
