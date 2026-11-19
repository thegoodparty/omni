import { isDeepStrictEqual } from 'node:util'
import type { SuiteAPI, TestAPI, TestContext } from 'vitest'
import {
  excerpt,
  redactSecrets,
  renderValue,
  summarizePrompt,
} from './annotation'
import { createJudgeModel, type JudgeModel } from './judgeModel'

// An expected-result suite is a plain Vitest file. It grades a run against a
// result a person already ruled correct, where a pairwise suite compares two
// builds of the same agent against each other.
export const ATTEMPTS_PER_CASE = 3

export type Annotate = (message: string, type: string) => Promise<void>

// A case's run may record its own steps, so a report says how the output came
// to be and not just what it was.
export type ExpectedResultRunContext = { annotate: Annotate }

export type ExpectedResultJudgeContext<Input> = {
  input: Input
  // One generateObject call, returning what the schema parsed. A suite that
  // never calls it needs no JUDGE_MODEL.
  judgeModel: JudgeModel
}

export type ExpectedResultEvalCase<Input, Judgment> = {
  id: string
  // The input is inferred from `run`, so a case whose input does not fit it
  // fails to compile instead of failing at run time.
  input: NoInfer<Input>
  // The judgment a person ruled correct. Every attempt must reproduce it.
  expected: NoInfer<Judgment>
}

export type ExpectedResultEvalSuite<Input, Output, Judgment> = {
  readonly isExpectedResultEvalSuite: true
  name: string
  run: (input: Input, ctx: ExpectedResultRunContext) => Promise<Output>
  judge: (
    output: Output,
    ctx: ExpectedResultJudgeContext<Input>,
  ) => Promise<Judgment>
  cases: ExpectedResultEvalCase<Input, Judgment>[]
}

export type ExpectedResultEvalSuiteDefinition<Input, Output, Judgment> = {
  run: (input: Input, ctx: ExpectedResultRunContext) => Promise<Output>
  judge: (
    output: Output,
    ctx: ExpectedResultJudgeContext<Input>,
  ) => Promise<Judgment>
  cases: ExpectedResultEvalCase<Input, Judgment>[]
}

// Vitest injects `describe` and `it` as globals (`globals: true` in
// `vitest.evals.config.ts`). They are read off `globalThis` rather than
// imported, because the pairwise runner loads these same files with tsx, and
// there an import of vitest throws: a suite file has to load there too, and
// register nothing.
export type VitestGlobals = { describe: SuiteAPI; it: TestAPI }

export const vitestGlobals = (): VitestGlobals | undefined => {
  const globals = globalThis as Partial<VitestGlobals>
  return globals.describe !== undefined && globals.it !== undefined
    ? { describe: globals.describe, it: globals.it }
    : undefined
}

export const annotateWith =
  (context: Pick<TestContext, 'annotate'>): Annotate =>
  async (message, type) => {
    await context.annotate(redactSecrets(message), type)
  }

// Wraps a model so every call a suite makes lands in the test's own record: the
// prompt it was given and the answer it produced.
export const annotateJudgeModel =
  (annotate: Annotate, model: JudgeModel): JudgeModel =>
  async (schema, prompt) => {
    await annotate(`judge prompt: ${summarizePrompt(prompt)}`, 'judge-prompt')
    const answer = await model(schema, prompt)
    await annotate(
      `judge answer: ${excerpt(renderValue(answer))}`,
      'judge-answer',
    )
    return answer
  }

const runAttempt = async <Input, Output, Judgment>(
  suite: ExpectedResultEvalSuite<Input, Output, Judgment>,
  theCase: ExpectedResultEvalCase<Input, Judgment>,
  attempt: number,
  model: JudgeModel,
  annotate: Annotate,
): Promise<Judgment> => {
  await annotate(
    `${theCase.id}, attempt ${attempt} of ${ATTEMPTS_PER_CASE}`,
    'attempt',
  )
  const output = await suite.run(theCase.input, { annotate })
  await annotate(`run output: ${excerpt(renderValue(output))}`, 'run-output')
  const judgment = await suite.judge(output, {
    input: theCase.input,
    judgeModel: annotateJudgeModel(annotate, model),
  })
  await annotate(`judgment: ${excerpt(renderValue(judgment))}`, 'judgment')
  if (!isDeepStrictEqual(judgment, theCase.expected)) {
    await annotate(
      `expected: ${renderValue(theCase.expected)}\n` +
        `actual: ${renderValue(judgment)}`,
      'expected-vs-actual',
    )
  }
  return judgment
}

// Exported so a unit test can drive it with fake globals and a fake model.
// Every attempt runs before any of them is asserted, so a mismatch's record
// says which attempts disagreed instead of stopping at the first.
export const registerSuite = <Input, Output, Judgment>(
  suite: ExpectedResultEvalSuite<Input, Output, Judgment>,
  vitest: VitestGlobals,
  model: JudgeModel,
): void => {
  vitest.describe(suite.name, () => {
    for (const theCase of suite.cases) {
      vitest.it.concurrent(theCase.id, async (context) => {
        const annotate = annotateWith(context)
        const judgments: Judgment[] = []
        for (let attempt = 1; attempt <= ATTEMPTS_PER_CASE; attempt++) {
          judgments.push(
            await runAttempt(suite, theCase, attempt, model, annotate),
          )
        }
        for (const [index, judgment] of judgments.entries()) {
          context
            .expect(judgment, `attempt ${index + 1}`)
            .toEqual(theCase.expected)
        }
      })
    }
  })
}

export const defineExpectedResultEvalSuite = <Input, Output, Judgment>(
  name: string,
  definition: ExpectedResultEvalSuiteDefinition<Input, Output, Judgment>,
): ExpectedResultEvalSuite<Input, Output, Judgment> => {
  if (!name) throw new Error('An eval suite needs a name')
  if (definition.cases.length === 0) {
    throw new Error(`Suite '${name}' has no cases`)
  }
  const ids = new Set<string>()
  for (const theCase of definition.cases) {
    if (!theCase.id) throw new Error(`Suite '${name}' has a case with no id`)
    if (ids.has(theCase.id)) {
      throw new Error(`Suite '${name}' has two cases with id '${theCase.id}'`)
    }
    ids.add(theCase.id)
  }
  const suite: ExpectedResultEvalSuite<Input, Output, Judgment> = {
    ...definition,
    name,
    isExpectedResultEvalSuite: true,
  }
  const vitest = vitestGlobals()
  if (vitest) registerSuite(suite, vitest, createJudgeModel())
  return suite
}

// The pairwise runner globs the same `*.eval.ts` files, and it owns only the
// pairwise ones: a file it finds that this helper defined is skipped there.
export const isExpectedResultEvalSuite = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  (value as { isExpectedResultEvalSuite?: unknown })
    .isExpectedResultEvalSuite === true
