import axios from 'axios'
import type { Grader, GradedPair } from './grade'
import { DEFAULT_DIMENSIONS, type Dimension } from './grade'
import { runPool } from './pool'
import type { ArmName } from './arm'
import { createArmContext, type ArmContext } from './arm'
import type {
  EvalCase,
  EvalContext,
  PairwiseAgentEvalSuite,
  SuiteProfile,
} from './suite'

// The run. For every case and its three attempts, both arms run at once in one
// shared pool: sign in, setup, run, keep the output string. A pair is graded as
// soon as attempt N exists on both sides, so grading overlaps the runs still
// landing.
//
// A pair with a failed run on either side is never graded. Two outputs are what
// the judge compares, and a run that threw has none: grading the marker instead
// reads the arm that ran as the better one, which is how a candidate whose
// routes were not deployed yet once scored 18-0 (PR #3926). Such a pair is
// counted as not judged, and enough of them make the suite impossible to judge.

export const ATTEMPTS_PER_SIDE = 3

export type ArmRun = {
  arm: ArmName
  caseId: string
  attempt: number
  // The exact text the judge reads. Null when the run threw; `error` says why.
  output: string | null
  error: string | null
  // The status the run died on, when it died on an HTTP response.
  httpStatus: number | null
  // What the setup and the run spent, in wall-clock milliseconds.
  setupMs: number
  runMs: number
  user: ArmContext['user']
}

// One (case, attempt) that never reached the grader, and the arms that kept it
// from doing so.
export type NotJudgedPair = {
  caseId: string
  attempt: number
  failedArms: ArmName[]
}

export type CaseResult = {
  caseId: string
  input: unknown
  runs: ArmRun[]
  pairs: GradedPair[]
  notJudged: NotJudgedPair[]
}

export type SuiteResult = {
  suite: string
  mode: PairwiseAgentEvalSuite<unknown>['mode']
  profile: SuiteProfile
  dimensions: Dimension[]
  cases: CaseResult[]
  usage: { inputTokens: number; outputTokens: number }
}

export type ExecuteSuiteOptions = {
  suite: PairwiseAgentEvalSuite<unknown>
  baseUrl: string
  candidateUrl: string
  grader: Grader
  concurrency: number
  // Suite-level extra questions from the suite author, merged over the
  // defaults. A case's own `dimensions` win.
  defaultDimensions?: Record<string, string>
  // Injected so a test drives provisioning and the agent route.
  createArmContextFn?: typeof createArmContext
  now?: () => number
  // Called as each pair is graded, so a long run shows progress.
  onPairGraded?: (suiteName: string, pair: GradedPair) => void
  // Called for each pair a failed run kept from the grader, for the same reason.
  onPairNotJudged?: (suiteName: string, pair: NotJudgedPair) => void
}

type SideJob = {
  caseId: string
  input: unknown
  theCase: EvalCase<unknown>
  arm: ArmName
  attempt: number
}

const dimensionsFor = (
  theCase: EvalCase<unknown>,
  defaults: Record<string, string>,
): Dimension[] => {
  const merged = { ...defaults, ...(theCase.grading?.dimensions ?? {}) }
  return Object.entries(merged).map(([name, question]) => ({ name, question }))
}

// The status a thrown run died on, when it died on an HTTP response rather than
// on a timeout or a bug in a suite. The report names one arm-wide status to say
// which deploy is missing a route.
const httpStatusOf = (thrown: unknown): number | null =>
  axios.isAxiosError(thrown) ? (thrown.response?.status ?? null) : null

const taskFor = (suiteName: string, theCase: EvalCase<unknown>): string => {
  const parts = [`Suite: ${suiteName}`, `Case: ${theCase.id}`]
  if (theCase.grading?.condition) parts.push(theCase.grading.condition)
  parts.push(`Input: ${JSON.stringify(theCase.input)}`)
  return parts.join('\n')
}

export const executeSuite = async (
  options: ExecuteSuiteOptions,
): Promise<SuiteResult> => {
  const {
    suite,
    baseUrl,
    candidateUrl,
    grader,
    concurrency,
    defaultDimensions = DEFAULT_DIMENSIONS,
    createArmContextFn = createArmContext,
    now = Date.now,
    onPairGraded,
    onPairNotJudged,
  } = options

  const jobs: SideJob[] = []
  for (const theCase of suite.cases) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_SIDE; attempt += 1) {
      for (const arm of ['base', 'candidate'] as const) {
        jobs.push({
          caseId: theCase.id,
          input: theCase.input,
          theCase,
          arm,
          attempt,
        })
      }
    }
  }

  // A pair is graded the first time both sides of (case, attempt) exist, and
  // never twice: `grading` is the promise, so a third run landing for the same
  // key sees it and does nothing.
  const pending = new Map<string, ArmRun>()
  const pairs: GradedPair[] = []
  const notJudged: NotJudgedPair[] = []
  const gradingPromises = new Map<string, Promise<void>>()

  const noteRun = async (run: ArmRun): Promise<void> => {
    const key = `${run.caseId}\u0000${run.attempt}`
    pending.set(`${key}\u0000${run.arm}`, run)
    if (gradingPromises.has(key)) return
    const base = pending.get(`${key}\u0000base`)
    const candidate = pending.get(`${key}\u0000candidate`)
    if (!base || !candidate) return

    const failedArms = [base, candidate]
      .filter((side) => side.error !== null)
      .map((side) => side.arm)
    if (failedArms.length > 0) {
      const skipped = {
        caseId: run.caseId,
        attempt: run.attempt,
        failedArms,
      }
      notJudged.push(skipped)
      onPairNotJudged?.(suite.name, skipped)
      gradingPromises.set(key, Promise.resolve())
      return
    }

    const theCase = suite.cases.find((entry) => entry.id === run.caseId)!
    const grading = theCase.grading ?? {}
    const dimensionList = dimensionsFor(theCase, defaultDimensions)
    const pairRequest = {
      caseId: run.caseId,
      attempt: run.attempt,
      task: taskFor(suite.name, theCase),
      grading: {
        ...(grading.condition ? { condition: grading.condition } : {}),
        ...(grading.handledWhen ? { handledWhen: grading.handledWhen } : {}),
        ...(grading.dimensions ? { dimensions: grading.dimensions } : {}),
      },
      dimensions: dimensionList,
      // Both are the suite's own output: a failed side never reaches here.
      baseOutput: base.output!,
      candidateOutput: candidate.output!,
    }
    const graded = grader.gradePair(pairRequest).then((pair) => {
      pairs.push(pair)
      onPairGraded?.(suite.name, pair)
    })
    gradingPromises.set(key, graded)
    await graded
  }

  const runs = await runPool(jobs, concurrency, async (job) => {
    const armContext = await createArmContextFn({
      arm: job.arm,
      baseUrl: job.arm === 'base' ? baseUrl : candidateUrl,
      profile: suite.profile,
      mode: suite.mode,
    })
    let output: string | null = null
    let error: string | null = null
    let httpStatus: number | null = null
    let setupMs = 0
    let runMs = 0

    try {
      if (job.theCase.setup) {
        const started = now()
        await job.theCase.setup(armContext.ctx)
        setupMs = now() - started
      }
      const runStarted = now()
      output = await suite.run(job.theCase.input, armContext.ctx)
      runMs = now() - runStarted
      if (typeof output !== 'string') {
        throw new Error(
          `suite '${suite.name}' case '${job.caseId}' returned ${typeof output}, not a string`,
        )
      }
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown)
      httpStatus = httpStatusOf(thrown)
    }

    const armRun: ArmRun = {
      arm: job.arm,
      caseId: job.caseId,
      attempt: job.attempt,
      output,
      error,
      httpStatus,
      setupMs,
      runMs,
      user: armContext.user,
    }
    await noteRun(armRun)
    return armRun
  })

  await Promise.all(gradingPromises.values())

  const cases: CaseResult[] = suite.cases.map((theCase) => ({
    caseId: theCase.id,
    input: theCase.input,
    runs: runs.filter((run) => run.caseId === theCase.id),
    pairs: pairs
      .filter((pair) => pair.caseId === theCase.id)
      .sort((left, right) => left.attempt - right.attempt),
    notJudged: notJudged
      .filter((pair) => pair.caseId === theCase.id)
      .sort((left, right) => left.attempt - right.attempt),
  }))

  const usage = pairs.reduce(
    (total, pair) => ({
      inputTokens: total.inputTokens + pair.usage.inputTokens,
      outputTokens: total.outputTokens + pair.usage.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 },
  )

  return {
    suite: suite.name,
    mode: suite.mode,
    profile: suite.profile,
    dimensions: Object.entries(defaultDimensions).map(([name, question]) => ({
      name,
      question,
    })),
    cases,
    usage,
  }
}
