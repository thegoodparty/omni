import { appendFileSync } from 'node:fs'
import { z } from 'zod'
import { priceAgentSet } from './guardPricing'
import { decideSpendCap } from './spendCap'

// ENG-11592: the workflow step `judge-guard.yml` runs right after the
// picker, under `npx tsx`, the same invocation shape as `runPickerCli.ts`
// (never a booted Nest app — this workflow reads main's own checkout as
// data, see judge-guard.yml's header).
const EnvSchema = z.object({
  GUARD_FLOOR: z.string().default(''),
  // The picker's own `final_agents` output: the floor plus whatever it
  // added. Always a superset of GUARD_FLOOR.
  GUARD_FINAL_AGENTS: z.string().default(''),
  // 0 until the ledger story (S14) supplies the PR's real spend so far
  // (spendCap.ts's own header). A separate env var, not a hardcoded 0 in
  // this file, so that story only has to change the workflow step's env,
  // never this CLI.
  GUARD_SPENT_SO_FAR_CENTS: z.string().default('0'),
  GITHUB_OUTPUT: z.string().min(1),
})

const splitAgents = (value: string): string[] =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

const writeOutput = (path: string, key: string, value: string): void => {
  const delimiter = `ghadelim_${Math.random().toString(36).slice(2)}`
  appendFileSync(path, `${key}<<${delimiter}\n${value}\n${delimiter}\n`, 'utf8')
}

export const main = (): void => {
  const env = EnvSchema.parse(process.env)
  const floorAgents = splitAgents(env.GUARD_FLOOR)
  const fullAgents = splitAgents(env.GUARD_FINAL_AGENTS)
  const spentCents = Number(env.GUARD_SPENT_SO_FAR_CENTS)
  if (!Number.isFinite(spentCents) || spentCents < 0) {
    throw new Error(
      `GUARD_SPENT_SO_FAR_CENTS must be a non-negative number, got ` +
        `${env.GUARD_SPENT_SO_FAR_CENTS}`,
    )
  }

  const floorEstimate = priceAgentSet(floorAgents)
  const fullEstimate = priceAgentSet(fullAgents)

  const decision = decideSpendCap({
    spentCents,
    floorAgents,
    floorEstimateCents: floorEstimate.cents,
    fullAgents,
    fullEstimateCents: fullEstimate.cents,
  })

  writeOutput(env.GITHUB_OUTPUT, 'scope', decision.scope)
  writeOutput(
    env.GITHUB_OUTPUT,
    'agents_to_run',
    decision.agentsToRun.join(','),
  )
  writeOutput(
    env.GITHUB_OUTPUT,
    'skipped_agents',
    decision.skippedAgents.join(','),
  )
  writeOutput(env.GITHUB_OUTPUT, 'judge_command', decision.judgeCommand ?? '')
  writeOutput(env.GITHUB_OUTPUT, 'cap_note', decision.note)

  console.log(
    `::notice::guard spend cap: scope=${decision.scope} ` +
      `agents_to_run=${decision.agentsToRun.join(',') || '(none)'} ` +
      `full_estimate=${fullEstimate.cents}c floor_estimate=${floorEstimate.cents}c ` +
      `spent=${spentCents}c`,
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
