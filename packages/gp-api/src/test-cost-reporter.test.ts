import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import {
  APP_BOOT_MEDIAN_CEILING_MS,
  FILE_CEILING_MS,
  TEST_CEILING_MS,
  TestCostBudget,
  TestCostBudgetSchema,
  TestCostFile,
  testCostFailures,
} from './test-cost-reporter'

const root = resolve(__dirname, '..')
const FILE = 'src/test-cost-reporter.test.ts'

const emptyBudget: TestCostBudget = {
  freshModulesFiles: 5,
  slowFiles: [],
  slowTests: [],
}

const ranFile = (overrides: Partial<TestCostFile> = {}): TestCostFile => ({
  file: FILE,
  ms: 100,
  passed: true,
  tests: [{ name: 'suite > fast', ms: 10, passed: true }],
  ...overrides,
})

const failuresFor = ({
  budget = emptyBudget,
  files = [ranFile()],
  appBootMs = [900],
  freshModulesFiles = 5,
}: {
  budget?: TestCostBudget
  files?: TestCostFile[]
  appBootMs?: number[]
  freshModulesFiles?: number
}) => testCostFailures({ root, budget, files, appBootMs, freshModulesFiles })

describe('testCostFailures', () => {
  it('passes a run that is under every ceiling and on budget', () => {
    expect(failuresFor({})).toEqual([])
  })

  it('fails a test over the ceiling and names it', () => {
    const failures = failuresFor({
      files: [
        ranFile({
          tests: [
            { name: 'suite > slow', ms: TEST_CEILING_MS + 1, passed: true },
          ],
        }),
      ],
    })

    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('"suite > slow"')
  })

  it('lets an allowlisted test run over the ceiling', () => {
    const failures = failuresFor({
      budget: {
        ...emptyBudget,
        slowTests: [{ file: FILE, test: 'suite > slow', reason: 'seed' }],
      },
      files: [
        ranFile({
          tests: [
            { name: 'suite > slow', ms: TEST_CEILING_MS * 2, passed: true },
          ],
        }),
      ],
    })

    expect(failures).toEqual([])
  })

  it('fails an allowlisted test once it runs well under the ceiling, so its entry gets deleted', () => {
    const budget = {
      ...emptyBudget,
      slowTests: [{ file: FILE, test: 'suite > slow', reason: 'seed' }],
    }
    const runAt = (ms: number) =>
      failuresFor({
        budget,
        files: [
          ranFile({ tests: [{ name: 'suite > slow', ms, passed: true }] }),
        ],
      })

    expect(runAt(TEST_CEILING_MS / 2)).toEqual([])
    expect(runAt(TEST_CEILING_MS / 4)).toEqual([
      expect.stringContaining('Delete its entry from slowTests'),
    ])
  })

  it('fails a file over the ceiling unless it is allowlisted, and an allowlisted file once it runs well under', () => {
    const slowFileBudget = {
      ...emptyBudget,
      slowFiles: [{ file: FILE, reason: 'many tests' }],
    }

    expect(
      failuresFor({ files: [ranFile({ ms: FILE_CEILING_MS + 1 })] }),
    ).toEqual([expect.stringContaining('ceiling for one test file')])
    expect(
      failuresFor({
        budget: slowFileBudget,
        files: [ranFile({ ms: FILE_CEILING_MS + 1 })],
      }),
    ).toEqual([])
    expect(
      failuresFor({
        budget: slowFileBudget,
        files: [ranFile({ ms: FILE_CEILING_MS / 4 })],
      }),
    ).toEqual([expect.stringContaining('Delete its entry from slowFiles')])
  })

  it('fails an entry for a file that no longer exists, even when it did not run in this shard', () => {
    const failures = failuresFor({
      budget: {
        ...emptyBudget,
        slowFiles: [{ file: 'src/deleted.test.ts', reason: 'gone' }],
      },
      files: [],
    })

    expect(failures).toEqual([expect.stringContaining('no longer exists')])
  })

  it('fails an entry for a test its file no longer has, only when that file ran', () => {
    const budget = {
      ...emptyBudget,
      slowTests: [{ file: FILE, test: 'suite > renamed', reason: 'seed' }],
    }

    expect(failuresFor({ budget })).toEqual([
      expect.stringContaining('has no test by that name'),
    ])
    expect(failuresFor({ budget, files: [] })).toEqual([])
  })

  it('fails when the median app boot is over the ceiling', () => {
    expect(
      failuresFor({
        appBootMs: [100, APP_BOOT_MEDIAN_CEILING_MS + 1, 99_999],
      }),
    ).toEqual([expect.stringContaining('median useTestService() boot')])
    expect(
      failuresFor({ appBootMs: [100, 200, APP_BOOT_MEDIAN_CEILING_MS * 10] }),
    ).toEqual([])
  })

  it('fails when the fresh-modules file count grows past the budget, and when it shrinks without lowering it', () => {
    expect(failuresFor({ freshModulesFiles: 6 })).toEqual([
      expect.stringContaining('over the budget of 5'),
    ])
    expect(failuresFor({ freshModulesFiles: 4 })).toEqual([
      expect.stringContaining('from 5 to 4'),
    ])
  })
})

describe('test-cost-budget.json', () => {
  it('parses, with a reason on every allowlist entry', () => {
    expect(() =>
      TestCostBudgetSchema.parse(
        JSON.parse(
          readFileSync(resolve(root, 'test-cost-budget.json'), 'utf8'),
        ),
      ),
    ).not.toThrow()
  })
})
