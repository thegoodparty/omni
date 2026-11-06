import { appendFileSync } from 'node:fs'
import { z } from 'zod'
import {
  applyRuling,
  recentMonthKeys,
  type ApplyRulingOutcome,
  type GuardRuling,
} from './guardLedger'
import { guardLedgerPortFromEnv } from './guardLedgerCli'

// Invoked from judge.yml's `ruling` job — the one job in the judge trigger
// chain that holds the judge-sweep AWS role (same reasoning as
// guardLedgerCli.ts's own header), once judge-comment.yml's write-access
// gate and `JUDGE_GUARD_ENABLED` check have already passed. judge-comment.yml
// itself holds no AWS credentials, so recording a ruling — which mutates the
// same `_judge/guard/<yyyy-mm>.jsonl` object the sweep appends to — has to
// cross into this file's job the same way a sweep does (Implementation
// Notes 6: "a small ruling mode that judge-comment.yml dispatches on
// judge.yml, which has the role").
export const EnvSchema = z
  .object({
    JUDGE_RECORDS_BUCKET: z.string().min(1).optional(),
    JUDGE_RECORDS_DIR: z.string().min(1).optional(),
    RULING_PR_NUMBER: z.coerce.number().int().positive(),
    RULING_HEAD_SHA: z.string().min(1),
    RULING_BY: z.string().min(1),
    RULING_KIND: z.enum(['agree', 'dispute']),
    // Absent, not merely empty, for `agree` — kept as a raw string here and
    // turned into `undefined` in `buildRuling` below, so an `agree` ruling
    // never carries a stray `reason: ''` the schema would then have to
    // special-case again.
    RULING_REASON: z.string().default(''),
    GITHUB_OUTPUT: z.string().min(1).optional(),
  })
  .refine(
    (env) => env.RULING_KIND !== 'dispute' || env.RULING_REASON.trim() !== '',
    {
      message: 'a dispute ruling requires a reason',
      path: ['RULING_REASON'],
    },
  )

export const buildRuling = (env: z.infer<typeof EnvSchema>): GuardRuling => ({
  by: env.RULING_BY,
  kind: env.RULING_KIND,
  ...(env.RULING_KIND === 'dispute' ? { reason: env.RULING_REASON } : {}),
})

// One message per outcome, written both to the log and — through
// `GITHUB_OUTPUT` — to the workflow step that posts it back on the PR
// thread. Someone asked a question in a comment; silence on this CLI's own
// console is not the same as an answer on the thread, so the workflow step
// reading this output is what actually closes the loop.
export const MESSAGE_BY_OUTCOME: Record<
  Exclude<ApplyRulingOutcome, 'applied'>,
  (prNumber: number, headSha: string) => string
> = {
  no_worse: (pr, sha) =>
    `PR #${pr} at \`${sha.slice(0, 12)}\` has no WORSE verdict to rule on.`,
  already_ruled: (pr, sha) =>
    `PR #${pr} at \`${sha.slice(0, 12)}\` already has a ruling — it is not overwritten.`,
  not_found: (pr, sha) =>
    `No guard sweep is recorded for PR #${pr} at \`${sha.slice(0, 12)}\`.`,
}

const writeOutput = (key: string, value: string): void => {
  const { GITHUB_OUTPUT } = process.env
  if (GITHUB_OUTPUT === undefined) return
  // Heredoc form, not `key=value`: a dispute reason is free text from a PR
  // comment and can carry a newline, which the plain workflow-command form
  // cannot. The delimiter is fixed, not random, because this CLI writes each
  // output exactly once per run.
  appendFileSync(
    GITHUB_OUTPUT,
    `${key}<<GP_RULING_EOF\n${value}\nGP_RULING_EOF\n`,
    'utf8',
  )
}

export const main = async (): Promise<void> => {
  const env = EnvSchema.parse(process.env)
  const port = guardLedgerPortFromEnv(env)

  const result = await applyRuling(
    port,
    {
      pr: env.RULING_PR_NUMBER,
      headSha: env.RULING_HEAD_SHA,
      ruling: buildRuling(env),
    },
    // Two months, same window `guardLedgerCli.ts` and the spend cap use —
    // a PR open across a month boundary still has to find its own sweep.
    recentMonthKeys(new Date(), 2),
  )

  writeOutput('outcome', result.outcome)

  if (result.outcome === 'applied') {
    console.log(
      `recorded a ${env.RULING_KIND} ruling by @${env.RULING_BY} on PR ` +
        `#${env.RULING_PR_NUMBER} at ${env.RULING_HEAD_SHA}`,
    )
    writeOutput('agents', Object.keys(result.line.verdicts).join(','))
    return
  }

  const message = MESSAGE_BY_OUTCOME[result.outcome](
    env.RULING_PR_NUMBER,
    env.RULING_HEAD_SHA,
  )
  console.log(message)
  writeOutput('message', message)
}

if (require.main === module) {
  void main().catch((err: Error) => {
    console.error(err.message)
    process.exitCode = 1
  })
}
