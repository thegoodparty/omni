import { appendFileSync, existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type {
  Reporter,
  TestModule,
  TestRunEndReason,
  Vitest,
} from 'vitest/node'
import { z } from 'zod'

// Roughly 3x the slowest test and file that were not outliers in 16 green
// main runs (2026-10-29), and 3x the per-shard median boot (0.7-1.2s), so a
// slow runner cannot trip them. The outliers are the allowlist in
// test-cost-budget.json.
export const TEST_CEILING_MS = 10_000
export const FILE_CEILING_MS = 30_000
export const APP_BOOT_MEDIAN_CEILING_MS = 3_000

// An allowlisted entry only counts as fixed once it is well under its
// ceiling. Entries sit near it, and "under the ceiling" alone would flap on
// runner noise.
const STALE_FRACTION = 1 / 4

const BUDGET_PATH = 'test-cost-budget.json'

export const TestCostBudgetSchema = z.object({
  freshModulesFiles: z.number().int(),
  slowFiles: z.array(z.object({ file: z.string(), reason: z.string().min(1) })),
  slowTests: z.array(
    z.object({ file: z.string(), test: z.string(), reason: z.string().min(1) }),
  ),
})

export type TestCostBudget = z.infer<typeof TestCostBudgetSchema>

export type TestCostFile = {
  file: string
  ms: number
  passed: boolean
  tests: { name: string; ms: number | undefined; passed: boolean }[]
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle]
  if (upper === undefined) return undefined
  return sorted.length % 2 === 1
    ? upper
    : ((sorted[middle - 1] ?? upper) + upper) / 2
}

export const testCostFailures = ({
  root,
  budget,
  files,
  appBootMs,
  freshModulesFiles,
}: {
  root: string
  budget: TestCostBudget
  files: TestCostFile[]
  appBootMs: number[]
  freshModulesFiles: number
}): string[] => {
  const failures: string[] = []

  for (const { file, ms, passed, tests } of files) {
    const fileEntry = budget.slowFiles.find((entry) => entry.file === file)
    if (ms > FILE_CEILING_MS && !fileEntry) {
      failures.push(
        `${file} took ${seconds(ms)}, over the ${seconds(FILE_CEILING_MS)} ceiling for one test file. ` +
          `Make its slowest tests cheaper (run \`npx vitest run ${file}\` to see them): seed a few rows instead of thousands, ` +
          `call CLI entry points in-process instead of spawning them, and use fake timers instead of real waits. ` +
          `See "Test cost" in packages/gp-api/docs/writing-tests.md.`,
      )
    }
    if (fileEntry && passed && ms < FILE_CEILING_MS * STALE_FRACTION) {
      failures.push(
        `${file} is on the slow-file allowlist but took ${seconds(ms)}, well under the ${seconds(FILE_CEILING_MS)} ceiling. ` +
          `Delete its entry from slowFiles in packages/gp-api/${BUDGET_PATH}.`,
      )
    }

    for (const test of tests) {
      if (test.ms === undefined) continue
      const testEntry = budget.slowTests.find(
        (entry) => entry.file === file && entry.test === test.name,
      )
      if (test.ms > TEST_CEILING_MS && !testEntry) {
        failures.push(
          `"${test.name}" in ${file} took ${seconds(test.ms)}, over the ${seconds(TEST_CEILING_MS)} ceiling for one test. ` +
            `Make it cheaper: to cross a limit, make the limit overridable and seed a few rows; call CLI entry points in-process ` +
            `instead of spawning them; use fake timers instead of real waits. See "Test cost" in packages/gp-api/docs/writing-tests.md.`,
        )
      }
      if (
        testEntry &&
        test.passed &&
        test.ms < TEST_CEILING_MS * STALE_FRACTION
      ) {
        failures.push(
          `"${test.name}" in ${file} is on the slow-test allowlist but took ${seconds(test.ms)}, well under the ` +
            `${seconds(TEST_CEILING_MS)} ceiling. Delete its entry from slowTests in packages/gp-api/${BUDGET_PATH}.`,
        )
      }
    }
  }

  for (const entry of [...budget.slowFiles, ...budget.slowTests]) {
    if (!existsSync(resolve(root, entry.file))) {
      failures.push(
        `${entry.file} is on the test-cost allowlist but no longer exists. ` +
          `Delete its entry from packages/gp-api/${BUDGET_PATH}.`,
      )
    }
  }
  for (const entry of budget.slowTests) {
    const ran = files.find(({ file }) => file === entry.file)
    if (ran && !ran.tests.some(({ name }) => name === entry.test)) {
      failures.push(
        `"${entry.test}" is on the slow-test allowlist but ${entry.file} has no test by that name. ` +
          `Delete its entry from slowTests in packages/gp-api/${BUDGET_PATH}, or fix the name if the test was renamed.`,
      )
    }
  }

  const medianBootMs = median(appBootMs)
  if (medianBootMs !== undefined && medianBootMs > APP_BOOT_MEDIAN_CEILING_MS) {
    failures.push(
      `The median useTestService() boot was ${Math.round(medianBootMs)}ms, over the ${APP_BOOT_MEDIAN_CEILING_MS}ms ceiling. ` +
        `Something made every app boot slower: look for a new onModuleInit or provider constructor that does I/O or heavy work, ` +
        `and defer it until first use or skip it under NODE_ENV=test.`,
    )
  }

  if (freshModulesFiles > budget.freshModulesFiles) {
    failures.push(
      `${freshModulesFiles} test files call vi.mock, vi.doMock, vi.unmock or vi.resetModules, over the budget of ` +
        `${budget.freshModulesFiles}. Each one runs in the fresh-modules project and reimports the app graph (~5s). ` +
        `Use vi.spyOn on an app.get() instance or a module namespace, or appEnvOverrides for appEnvironment.util ` +
        `constants. See "Module mocks" in packages/gp-api/docs/writing-tests.md.`,
    )
  }
  if (freshModulesFiles < budget.freshModulesFiles) {
    failures.push(
      `Only ${freshModulesFiles} test files call vi.mock, vi.doMock, vi.unmock or vi.resetModules. Lower ` +
        `freshModulesFiles in packages/gp-api/${BUDGET_PATH} from ${budget.freshModulesFiles} to ${freshModulesFiles} ` +
        `so the budget cannot be spent again.`,
    )
  }

  return failures
}

// Only wired up when CI is set (vitest.config.ts): local runs are not gated.
export default class TestCostReporter implements Reporter {
  private vitest!: Vitest

  constructor(private readonly options: { freshModulesFiles: number }) {}

  onInit(vitest: Vitest) {
    this.vitest = vitest
  }

  onTestRunEnd(
    testModules: ReadonlyArray<TestModule>,
    _errors: unknown,
    reason: TestRunEndReason,
  ) {
    if (reason === 'interrupted') return

    const root = this.vitest.config.root
    const budget = TestCostBudgetSchema.parse(
      JSON.parse(readFileSync(resolve(root, BUDGET_PATH), 'utf8')),
    )
    const ran = testModules.filter(
      (testModule) =>
        testModule.state() !== 'skipped' && testModule.state() !== 'queued',
    )
    const files: (TestCostFile & { importMs: number })[] = ran.map(
      (testModule) => ({
        file: testModule.relativeModuleId,
        ms: testModule.diagnostic().duration,
        importMs: testModule.diagnostic().collectDuration,
        passed: testModule.state() === 'passed',
        tests: Array.from(testModule.children.allTests()).map((testCase) => ({
          name: testCase.fullName,
          ms: testCase.diagnostic()?.duration,
          passed: testCase.result().state === 'passed',
        })),
      }),
    )
    const appBootMs = ran.flatMap(
      (testModule) => testModule.meta().appBootMs ?? [],
    )
    const { freshModulesFiles } = this.options
    const failures = testCostFailures({
      root,
      budget,
      files,
      appBootMs,
      freshModulesFiles,
    })

    for (const failure of failures) {
      this.vitest.logger.error(
        process.env.GITHUB_ACTIONS === 'true'
          ? `::error title=gp-api test cost::${failure}`
          : `Test cost: ${failure}`,
      )
    }
    if (failures.length > 0) process.exitCode = 1

    const medianBootMs = median(appBootMs)
    this.vitest.logger.log(
      `Test cost: median useTestService() boot ${medianBootMs === undefined ? 'n/a' : `${Math.round(medianBootMs)}ms`} ` +
        `over ${appBootMs.length} boots (ceiling ${APP_BOOT_MEDIAN_CEILING_MS}ms).`,
    )

    const summaryPath = process.env.GITHUB_STEP_SUMMARY
    if (!summaryPath) return
    const shard = this.vitest.config.shard
    appendFileSync(
      summaryPath,
      [
        `### gp-api test cost${shard ? `, shard ${shard.index}/${shard.count}` : ''}`,
        '',
        `Median useTestService() boot: ${medianBootMs === undefined ? 'n/a' : `${Math.round(medianBootMs)}ms`} ` +
          `over ${appBootMs.length} boots (ceiling ${APP_BOOT_MEDIAN_CEILING_MS}ms).`,
        `fresh-modules files: ${freshModulesFiles} (budget ${budget.freshModulesFiles}).`,
        '',
        ...(failures.length > 0
          ? [
              '**Failures**',
              '',
              ...failures.map((failure) => `- ${failure}`),
              '',
            ]
          : []),
        '<details><summary>Per-file time</summary>',
        '',
        '| File | Tests | Time (ms) | Import (ms) |',
        '| --- | --- | --- | --- |',
        ...[...files]
          .sort((a, b) => b.ms - a.ms)
          .map(
            ({ file, tests, ms, importMs }) =>
              `| ${file} | ${tests.length} | ${Math.round(ms)} | ${Math.round(importMs)} |`,
          ),
        '',
        '</details>',
        '',
      ].join('\n'),
    )
  }
}
