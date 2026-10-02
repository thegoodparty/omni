import { appendFileSync } from 'node:fs'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'

// THE BACKGROUND BUDGET, READ ONCE FROM THE CANDIDATE AND HANDED TO BOTH ARMS.
//
// It lives in config.ts, and the base arm runs the base ref's config.ts in a
// second worktree — so without this a branch that changes the budget walks
// one budget on each arm, and judgeSweep refuses the pair after both have
// been billed. judge.yml runs this against the candidate checkout before
// either arm starts and passes the two values to both, the way it does the
// mart's Delta version.
//
// The CANDIDATE's value, because the sweep is a question about the candidate:
// a branch that changes the budget is asking for its new budget to be
// compared, and the base arm walking the same cases is what makes that a
// comparison at all.
//
// Lines for $GITHUB_OUTPUT. An absent cap prints `max_cases=` — blank, which
// sweepEnv reads as "no cap" because attempts is present.
export const budgetOutputLines = (
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
): string =>
  `attempts=${config.background.attemptsPerCase}\n` +
  `max_cases=${config.background.maxCases ?? ''}\n`

// gp-api is CommonJS, so `require.main` is the house pattern — see
// dataVersion.ts and sweep.ts.
//
// FAILS HARD, unlike dataVersion.ts. The mart resolver can legitimately fail
// on the network and the sweep is still worth running unpinned. This reads a
// constant from a file in the same checkout; if it fails, the candidate's
// judge code is broken and the arms would fail anyway — and it runs before
// either arm, so failing here costs nothing.
if (require.main === module) {
  const outPath = process.argv[2]
  if (outPath === undefined || outPath === '') {
    process.stderr.write('usage: armBudget.ts <path to append outputs to>\n')
    process.exit(2)
  }
  appendFileSync(outPath, budgetOutputLines())
  process.stderr.write(
    `both arms will walk background agents at ${budgetOutputLines()
      .trim()
      .replace('\n', ', ')}\n`,
  )
}
