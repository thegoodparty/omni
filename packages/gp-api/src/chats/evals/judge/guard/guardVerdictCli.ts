import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import { resolveGuardVerdict } from './guardVerdict'

// ENG-11592: run after `judge-guard.yml`'s "Wait for the sweep" step has
// downloaded the dispatched run's `judge-report` artifact (judge.yml's own
// "Keep the report for the PR" step; see guardVerdict.ts's header for why
// this reads the report rather than the records). `GUARD_REPORT_FILE` is
// absent-on-disk, not merely empty, when the download never happened — a
// dispatch that could not be found, or a sweep that never reached the
// judging step — and that reads as an infra error, same as a sweep-reported
// `refused`.
const EnvSchema = z.object({
  GUARD_REPORT_FILE: z.string().min(1),
  GITHUB_OUTPUT: z.string().min(1),
})

const writeOutput = (path: string, key: string, value: string): void => {
  const delimiter = `ghadelim_${Math.random().toString(36).slice(2)}`
  appendFileSync(path, `${key}<<${delimiter}\n${value}\n${delimiter}\n`, 'utf8')
}

export const main = (): void => {
  const env = EnvSchema.parse(process.env)
  const report = existsSync(env.GUARD_REPORT_FILE)
    ? readFileSync(env.GUARD_REPORT_FILE, 'utf8')
    : undefined

  const verdict = resolveGuardVerdict(report)

  writeOutput(env.GITHUB_OUTPUT, 'outcome', verdict.outcome)
  writeOutput(env.GITHUB_OUTPUT, 'conclusion', verdict.conclusion)
  writeOutput(env.GITHUB_OUTPUT, 'note', verdict.note)

  console.log(
    `::notice::guard sweep verdict: outcome=${verdict.outcome} ` +
      `conclusion=${verdict.conclusion}`,
  )
}

if (require.main === module) {
  try {
    main()
  } catch (err: unknown) {
    console.error(err)
    process.exit(1)
  }
}
