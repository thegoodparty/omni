import { appendFileSync } from 'node:fs'
import { z } from 'zod'
import { parseGuardContext } from './guardContext'

// ENG-11593: the first thing judge.yml's sweep job does with the branch's
// own checkout, well before anything spends, so its outputs are ready for
// both the baseline-trailer step and the ledger-write step at the end of
// the run — including on cancellation, since the ledger line still has to
// carry the real floor/added/picker rather than nothing.
//
// `guard_context` arrives as a `workflow_call` input threaded from
// `judge-request.yml`. `judge-guard.yml` fills it; a person's `/judge` run
// leaves it empty, and empty means "not a guard sweep" everywhere else in
// this file reads `present`.
export const EnvSchema = z.object({
  GUARD_CONTEXT: z.string().default(''),
  GITHUB_OUTPUT: z.string().min(1),
})

const writeOutput = (path: string, key: string, value: string): void => {
  const delimiter = `ghadelim_${Math.random().toString(36).slice(2)}`
  appendFileSync(path, `${key}<<${delimiter}\n${value}\n${delimiter}\n`, 'utf8')
}

export const main = (): void => {
  const env = EnvSchema.parse(process.env)

  if (env.GUARD_CONTEXT.trim() === '') {
    writeOutput(env.GITHUB_OUTPUT, 'present', 'false')
    writeOutput(env.GITHUB_OUTPUT, 'floor', '')
    writeOutput(env.GITHUB_OUTPUT, 'added', '')
    writeOutput(env.GITHUB_OUTPUT, 'picker', '')
    console.log('::notice::guard context absent — this is not a guard sweep')
    return
  }

  const context = parseGuardContext(env.GUARD_CONTEXT)
  writeOutput(env.GITHUB_OUTPUT, 'present', 'true')
  writeOutput(env.GITHUB_OUTPUT, 'floor', context.floor.join(','))
  writeOutput(env.GITHUB_OUTPUT, 'added', context.added.join(','))
  writeOutput(env.GITHUB_OUTPUT, 'picker', context.picker)
  console.log(
    `::notice::guard context: floor=${context.floor.join(',') || '(none)'} ` +
      `added=${context.added.join(',') || '(none)'} picker=${context.picker}`,
  )
}

// A malformed guard_context is a bug in judge-guard.yml's own dispatch, not
// a normal input shape — this throws rather than falling back to "absent",
// because silently treating a broken guard sweep as a person's `/judge` run
// would write no ledger line for a sweep that really did spend.
if (require.main === module) {
  try {
    main()
  } catch (err: unknown) {
    console.error(err)
    process.exit(1)
  }
}
