import { resolve } from 'node:path'
import {
  parseJudgeCliArgs,
  selectedSuiteNames,
  JudgeCliError,
  USAGE,
} from './cli'
import { discoverSuites } from './discover'
import { executeSuite, ATTEMPTS_PER_SIDE } from './execute'
import { createGrader, DEFAULT_DIMENSIONS } from './grade'
import { resolveJudgeModel } from './model'
import { probeArm } from './arm'
import {
  verdictFor,
  writeResults,
  type RunSummary,
  type SuiteOutcome,
} from './report'

// npx tsx packages/judge/src/run.ts \
//   --base https://dev.goodparty.org \
//   --candidate https://pr-3904.preview.goodparty.org \
//   --suite trending_issues \
//   --judge-model anthropic/claude-sonnet-4-6 \
//   --out ./judge-results
//
// It loads suites from the checkout it runs in and imports nothing else from
// gp-api: the two URLs are the whole of its input.

export type RunDeps = {
  // Overridden by tests.
  executeSuiteFn?: typeof executeSuite
  discoverSuitesFn?: typeof discoverSuites
  probeArmFn?: typeof probeArm
  resolveJudgeModelFn?: (
    judgeModel: string,
  ) => ReturnType<typeof resolveJudgeModel>
  now?: () => Date
  log?: (message: string) => void
  // Where the suite glob is rooted; the invocation directory by default.
  checkoutRoot?: string
  // Where results.json and results.md are written; the invocation directory by
  // default.
  outputRoot?: string
}

export const runJudge = async (
  argv: readonly string[],
  deps: RunDeps = {},
): Promise<number> => {
  const log = deps.log ?? ((message: string) => console.log(message))
  const now = deps.now ?? (() => new Date())
  const checkoutRoot = deps.checkoutRoot ?? process.cwd()
  const outputRoot = deps.outputRoot ?? process.cwd()

  let options
  try {
    options = parseJudgeCliArgs(argv)
  } catch (error) {
    if (error instanceof JudgeCliError) {
      console.error(error.message)
      if (error.message !== USAGE) console.error(`\n${USAGE}`)
      return 2
    }
    throw error
  }

  let model
  try {
    model = (deps.resolveJudgeModelFn ?? resolveJudgeModel)(options.judgeModel)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }

  const startedAt = now().toISOString()

  // Fail before spending anything if an arm cannot be reached.
  const probe = deps.probeArmFn ?? probeArm
  for (const url of [options.base, options.candidate]) {
    const reachability = await probe(url)
    if (!reachability.ok) {
      console.error(
        `Arm ${url} is not reachable (${reachability.detail}); nothing was run.`,
      )
      return 1
    }
  }

  const discover = deps.discoverSuitesFn ?? discoverSuites
  let found
  try {
    found = await discover({
      checkoutRoot,
      selected: selectedSuiteNames(options.suite),
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }

  const grader = createGrader({ model })
  const execute = deps.executeSuiteFn ?? executeSuite

  log(
    `judging ${found.length} suite(s) on ${options.base} vs ${options.candidate} ` +
      `with ${options.judgeModel}, ${options.concurrency} in flight`,
  )

  const outcomes: SuiteOutcome[] = []
  for (const { suite, file } of found) {
    log(`\n== ${suite.name} (${suite.cases.length} cases, ${file})`)
    let result
    try {
      result = await execute({
        suite,
        baseUrl: options.base,
        candidateUrl: options.candidate,
        grader,
        concurrency: options.concurrency,
        defaultDimensions: DEFAULT_DIMENSIONS,
        onPairGraded: (_suiteName, pair) =>
          log(
            `  graded ${pair.caseId} attempt ${pair.attempt}: ${pair.winner}`,
          ),
      })
    } catch (error) {
      // A run that cannot provision, reach an arm, or call the model has no
      // verdict to report. Say which suite and stop, rather than writing a
      // results file that claims every pair tied.
      console.error(
        `\n${suite.name} could not run: ${error instanceof Error ? error.message : String(error)}`,
      )
      return 1
    }
    const verdict = verdictFor(result)
    outcomes.push({ result, verdict })
    log(
      `  ${suite.name}: ${verdict.label} ` +
        `(candidate ${verdict.sign.forCandidate}, base ${verdict.sign.forBase}, ` +
        `tied ${verdict.sign.ties}; handling ` +
        `${verdict.handled.candidatePass}/${verdict.handled.candidateTotal} ` +
        `vs ${verdict.handled.basePass}/${verdict.handled.baseTotal})`,
    )
  }

  const summary: RunSummary = {
    baseUrl: options.base,
    candidateUrl: options.candidate,
    judgeModel: options.judgeModel,
    startedAt,
    finishedAt: now().toISOString(),
    attemptsPerSide: ATTEMPTS_PER_SIDE,
    suites: outcomes,
  }

  // Resolved against the invocation directory, not the package.
  const written = await writeResults(resolve(outputRoot, options.out), summary)
  log(`\nwrote ${written.jsonPath} and ${written.markdownPath}`)

  const worse = outcomes.filter((outcome) => outcome.verdict.label === 'WORSE')
  if (worse.length > 0) {
    log(`\nWORSE: ${worse.map((outcome) => outcome.result.suite).join(', ')}`)
    return 1
  }
  return 0
}

// Only when this file is the program. Importing it — from a test, or from
// index.ts — must not start a run.
if (require.main === module) {
  runJudge(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    },
  )
}
