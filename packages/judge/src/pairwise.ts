import type { afterAll, beforeAll } from 'vitest'
import {
  annotateWith,
  suiteVerdictAnnotation,
  excerpt,
  redactSecrets,
  renderValue,
  type Annotate,
} from './annotation'
import { createArmContext, probeArm, type ArmName, type ArmUser } from './arm'
import { vitestGlobals, type VitestGlobals } from './expectedResult'
import { createGrader, DEFAULT_DIMENSIONS, type GradedPair } from './grade'
import { resolveJudgeModel } from './model'
import { handledRegressionP, readVerdict } from './stats'
import {
  createPairwiseAgentEvalSuite,
  type AgentRunResult,
  type EvalCase,
  type PairwiseAgentEvalSuite,
  type PairwiseAgentEvalSuiteDefinition,
} from './suite'

const ATTEMPTS = 3
const ARMS = ['base', 'candidate'] as const
const runArm = async <Input>(
  suite: PairwiseAgentEvalSuite<Input>,
  theCase: EvalCase<Input>,
  arm: ArmName,
  baseUrl: string,
  attempt: number,
  annotate: Annotate,
) => {
  const started = Date.now()
  let setupMs = 0
  let runMs = 0
  let user: ArmUser | undefined
  let output: string | undefined
  let error: string | undefined
  const runs: Pick<AgentRunResult, 'runId' | 'status' | 'engine'>[] = []
  try {
    const context = await createArmContext({
      arm,
      baseUrl,
      profile: suite.profile,
      mode: suite.mode,
      annotate,
    })
    user = context.user
    const ctx = {
      ...context.ctx,
      runAgent: async (
        name: string,
        input: Parameters<typeof context.ctx.runAgent>[1],
      ) => {
        const { runId, status, engine, ...result } = await context.ctx.runAgent(
          name,
          input,
        )
        runs.push({ runId, status, engine: engine ?? 'not reported' })
        return { runId, status, engine, ...result }
      },
    }
    const setupStarted = Date.now()
    try {
      await theCase.setup?.(ctx)
    } finally {
      setupMs = Date.now() - setupStarted
    }
    const runStarted = Date.now()
    try {
      const result = await suite.run(theCase.input, ctx)
      if (typeof result !== 'string')
        throw new Error('The suite did not return a string')
      output = result
    } finally {
      runMs = Date.now() - runStarted
    }
  } catch (thrown) {
    error = excerpt(thrown instanceof Error ? thrown.message : String(thrown))
  }
  await annotate(
    renderValue({
      arm,
      attempt,
      runs,
      setupMs,
      runMs,
      elapsedMs: Date.now() - started,
      status: error === undefined ? 'completed' : 'failed',
      clerkUserId: user?.clerkUserId,
      orgSlug: user?.orgSlug,
      output: output === undefined ? undefined : excerpt(output),
      error,
    }),
    'pairwise-run',
  )
  return { output, error, runs }
}

export type NotJudgedAttempt = {
  caseId: string
  attempt: number
  side: ArmName | 'grader'
  runs: Pick<AgentRunResult, 'runId' | 'status'>[]
  error: string
}

export type PairwiseVitest = VitestGlobals & {
  beforeAll: typeof beforeAll
  afterAll: typeof afterAll
}

export const registerPairwiseSuite = <Input>(
  suite: PairwiseAgentEvalSuite<Input>,
  vitest: PairwiseVitest,
  env = process.env,
) => {
  const urls = { base: env.JUDGE_BASE_URL, candidate: env.JUDGE_CANDIDATE_URL }
  const missing = [
    !urls.base && 'JUDGE_BASE_URL',
    !urls.candidate && 'JUDGE_CANDIDATE_URL',
  ].filter(Boolean)
  const message = `Pairwise eval ${suite.name}: set ${missing.join(' and ')}`
  if (missing.length && env.JUDGE_REQUIRE_PAIRWISE !== 'true') {
    console.info(message)
    vitest.describe.skip(suite.name, () => {
      for (const theCase of suite.cases)
        vitest.it.concurrent(theCase.id, () => {})
    })
    return
  }

  vitest.describe(suite.name, () => {
    let grader: ReturnType<typeof createGrader>
    const pairs: GradedPair[] = []
    const notJudged: NotJudgedAttempt[] = []
    let attempted = 0
    vitest.beforeAll(async () => {
      if (!urls.base || !urls.candidate) throw new Error(message)
      if (!env.JUDGE_MODEL) throw new Error('JUDGE_MODEL is not set')
      if (!env.CLERK_SECRET_KEY) throw new Error('CLERK_SECRET_KEY is not set')
      grader = createGrader({ model: resolveJudgeModel(env.JUDGE_MODEL) })
      const reachability = await Promise.all([
        probeArm(urls.base),
        probeArm(urls.candidate),
      ])
      const failures = reachability.filter((arm) => !arm.ok)
      if (failures.length)
        throw new Error(
          redactSecrets(failures.map((arm) => arm.detail).join('\n')),
        )
    }, 90_000)

    for (const theCase of suite.cases) {
      vitest.it.concurrent(
        theCase.id,
        async (context) => {
          const annotate = annotateWith(context)
          attempted += ATTEMPTS
          const grading = theCase.grading ?? {}
          const dimensions = Object.entries({
            ...DEFAULT_DIMENSIONS,
            ...grading.dimensions,
          }).map(([name, question]) => ({ name, question }))
          const results = await Promise.all(
            Array.from({ length: ATTEMPTS }, async (_, index) => {
              const attempt = index + 1
              const [base, candidate] = await Promise.all(
                ARMS.map((arm) =>
                  runArm(suite, theCase, arm, urls[arm]!, attempt, annotate),
                ),
              )
              for (const [side, arm] of [
                ['base', base!],
                ['candidate', candidate!],
              ] as const) {
                if (arm.output === undefined)
                  notJudged.push({
                    caseId: theCase.id,
                    attempt,
                    side,
                    runs: arm.runs.map(({ runId, status }) => ({
                      runId,
                      status,
                    })),
                    error: arm.error ?? 'no output',
                  })
              }
              const baseOutput = base!.output
              const candidateOutput = candidate!.output
              if (baseOutput === undefined || candidateOutput === undefined)
                return false
              try {
                const pair = await grader.gradePair({
                  caseId: theCase.id,
                  attempt,
                  grading,
                  dimensions,
                  baseOutput,
                  candidateOutput,
                  task: `Suite: ${suite.name}\nCase: ${theCase.id}\nInput: ${JSON.stringify(theCase.input)}`,
                })
                for (const {
                  aArm,
                  winner,
                  reasoning,
                  handled,
                  scores,
                } of pair.orders) {
                  await annotate(
                    renderValue({
                      attempt,
                      aArm,
                      winner,
                      reasoning,
                      handledWhen: handled,
                      scores,
                    }),
                    'pairwise-order',
                  )
                }
                await annotate(
                  renderValue({
                    attempt,
                    winner: pair.winner,
                    ordersAgree:
                      pair.orders[0]?.winner === pair.orders[1]?.winner,
                  }),
                  'pairwise-decision',
                )
                pairs.push(pair)
                return true
              } catch (error) {
                notJudged.push({
                  caseId: theCase.id,
                  attempt,
                  side: 'grader',
                  runs: [...base!.runs, ...candidate!.runs].map(
                    ({ runId, status }) => ({ runId, status }),
                  ),
                  error: excerpt(String(error)),
                })
                await annotate(
                  `Attempt ${attempt}: ${excerpt(String(error))}`,
                  'pairwise-not-judged',
                )
                return false
              }
            }),
          )
          if (!results.some(Boolean))
            throw new Error(`No pairs could be judged for ${theCase.id}`)
        },
        70 * 60_000,
      )
    }

    vitest.afterAll(({}, task) => {
      const handled = pairs.flatMap((pair) =>
        pair.handled ? [pair.handled] : [],
      )
      const basePass = handled.filter((pair) => pair.base).length
      const candidatePass = handled.filter((pair) => pair.candidate).length
      const verdict = readVerdict({
        votes: pairs.map((pair) => pair.winner),
        notJudged: attempted - pairs.length,
        handled: {
          basePass,
          candidatePass,
          baseTotal: handled.length,
          candidateTotal: handled.length,
          pWorse: handledRegressionP(
            candidatePass,
            handled.length - candidatePass,
            basePass,
            handled.length - basePass,
          ),
        },
      })
      Object.assign(task.meta, {
        pairwiseVerdict: suiteVerdictAnnotation(verdict),
        pairwiseNotJudged: suiteVerdictAnnotation(notJudged),
      })
      if (!attempted) return
      if (verdict.label === 'WORSE' || verdict.label === "CAN'T JUDGE") {
        throw new Error(`${suite.name}: ${verdict.label}`)
      }
    })
  })
}

export const definePairwiseAgentEvalSuite = <Input>(
  name: string,
  definition: PairwiseAgentEvalSuiteDefinition<Input>,
): PairwiseAgentEvalSuite<Input> => {
  const suite = createPairwiseAgentEvalSuite(name, definition)
  const vitest = vitestGlobals()
  const { beforeAll, afterAll } = globalThis as Partial<PairwiseVitest>
  if (vitest && beforeAll && afterAll)
    registerPairwiseSuite(suite, { ...vitest, beforeAll, afterAll })
  return suite
}
