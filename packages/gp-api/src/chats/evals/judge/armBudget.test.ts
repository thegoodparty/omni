import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { budgetOutputLines } from './armBudget'
import { DEFAULT_JUDGE_CONFIG, type ShapeBudget } from './config'
import { armEnvFor } from './fixtures/sweep'
import { armConfigFor, parseArmEnv, SweepEnvError } from './sweepEnv'

// THE BUDGET CROSSES A SEAM: armBudget.ts writes it in one process, judge.yml
// carries it through $GITHUB_OUTPUT into two other processes, and sweepEnv.ts
// reads it back in each. A test of either end alone cannot see the two ends
// disagreeing about the format — which is the failure, because a value the
// arm cannot parse falls back to that arm's own config, and the base arm's
// own config is the per-checkout budget this input exists to replace.
//
// So these tests round-trip. Every fixture budget DIFFERS from the default,
// because a round trip through a default proves nothing: an arm that ignored
// the input entirely would still arrive at the default.

const PARSE = (lines: string): NodeJS.ProcessEnv => {
  const out: NodeJS.ProcessEnv = {}
  for (const line of lines.split('\n')) {
    const at = line.indexOf('=')
    if (at > 0) out[line.slice(0, at)] = line.slice(at + 1)
  }
  return out
}

// How judge.yml maps the step's outputs onto both arms' env.
const intoArmEnv = (outputs: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  armEnvFor({
    JUDGE_BACKGROUND_ATTEMPTS: outputs.attempts,
    JUDGE_BACKGROUND_MAX_CASES: outputs.max_cases,
  })

const configWith = (background: ShapeBudget) => ({
  ...DEFAULT_JUDGE_CONFIG,
  background,
})

describe('the background budget survives the trip to both arms', () => {
  it.each<[string, ShapeBudget]>([
    ['a capped budget', { attemptsPerCase: 2, maxCases: 5 }],
    ['an uncapped budget', { attemptsPerCase: 4 }],
  ])('carries %s through intact', (_label, budget) => {
    const arm = parseArmEnv(
      intoArmEnv(PARSE(budgetOutputLines(configWith(budget)))),
    )
    expect(arm.backgroundBudget).toEqual(budget)
    expect(armConfigFor(arm).background).toEqual(budget)
  })

  // THE REAL ENTRY, run the way the workflow runs it. The pure round trip
  // above cannot see `require.main` failing to fire, an import that only
  // resolves under vitest's alias, or anything else printing into the file.
  // Under a second, because it is a constant read from one file.
  it('writes exactly what the arms read when run as the workflow runs it', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'budget-')), 'github-output')
    execFileSync('npx', ['tsx', join(__dirname, 'armBudget.ts'), out], {
      cwd: join(__dirname, '../../../..'),
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    const written = readFileSync(out, 'utf8')
    expect(written).toBe(budgetOutputLines())
    expect(parseArmEnv(intoArmEnv(PARSE(written))).backgroundBudget).toEqual(
      DEFAULT_JUDGE_CONFIG.background,
    )
  })
})

describe('reading the budget an arm was handed', () => {
  // No input means a local run, where the arm's own config decides.
  it('leaves the arm on its own config when nothing was resolved', () => {
    const arm = parseArmEnv(armEnvFor())
    expect(arm.backgroundBudget).toBeUndefined()
    expect(armConfigFor(arm)).toBe(DEFAULT_JUDGE_CONFIG)
  })

  // Only `background` is replaced. A wholesale swap would also reset the
  // chat attempts and the gates to whatever the arm's checkout says.
  it('replaces the background budget and nothing else', () => {
    const arm = parseArmEnv(
      armEnvFor({
        JUDGE_BACKGROUND_ATTEMPTS: '2',
        JUDGE_BACKGROUND_MAX_CASES: '5',
      }),
    )
    const config = armConfigFor(arm)
    expect(config.background).toEqual({ attemptsPerCase: 2, maxCases: 5 })
    expect({ ...config, background: undefined }).toEqual({
      ...DEFAULT_JUDGE_CONFIG,
      background: undefined,
    })
  })

  // Half a budget silently falls back to the arm's own config — the
  // per-checkout mismatch again — so it is refused instead.
  it('refuses a cap with no attempts', () => {
    expect(() =>
      parseArmEnv(armEnvFor({ JUDGE_BACKGROUND_MAX_CASES: '3' })),
    ).toThrow(/half a budget/)
  })

  // Everything z.coerce.number() would have let through as something nobody
  // wrote: "" as 0, "1.5" as a fraction of a case, "1e1" as ten.
  it.each(['0', '-1', '1.5', '1e1', 'three', ' 3x'])(
    'refuses %j as a count',
    (raw) => {
      expect(() =>
        parseArmEnv(armEnvFor({ JUDGE_BACKGROUND_ATTEMPTS: raw })),
      ).toThrow(SweepEnvError)
      expect(() =>
        parseArmEnv(
          armEnvFor({
            JUDGE_BACKGROUND_ATTEMPTS: '1',
            JUDGE_BACKGROUND_MAX_CASES: raw,
          }),
        ),
      ).toThrow(SweepEnvError)
    },
  )
})
