import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import { resolveGuardVerdict, type SuiteVerdictRow } from './guardVerdict'

const EnvSchema = z.object({
  GUARD_SUITES: z.string().min(1),
  GUARD_VERDICTS_FILE: z.string().min(1),
  GITHUB_OUTPUT: z.string().min(1),
})

const RowsSchema = z.array(z.object({ suite: z.string(), label: z.string() }))

const writeOutput = (path: string, key: string, value: string): void => {
  const delimiter = `ghadelim_${Math.random().toString(36).slice(2)}`
  appendFileSync(path, `${key}<<${delimiter}\n${value}\n${delimiter}\n`, 'utf8')
}

const readRows = (path: string): SuiteVerdictRow[] | undefined => {
  if (!existsSync(path)) return undefined
  const parsed = RowsSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
  return parsed.success ? parsed.data : undefined
}

export const main = (): void => {
  const env = EnvSchema.parse(process.env)
  const requested = env.GUARD_SUITES.split(',').filter((s) => s.length > 0)
  const verdict = resolveGuardVerdict(
    requested,
    readRows(env.GUARD_VERDICTS_FILE),
  )

  writeOutput(env.GITHUB_OUTPUT, 'outcome', verdict.outcome)
  writeOutput(env.GITHUB_OUTPUT, 'conclusion', verdict.conclusion)
  writeOutput(env.GITHUB_OUTPUT, 'note', verdict.note)

  console.log(
    `::notice::guard verdict: outcome=${verdict.outcome} ` +
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
