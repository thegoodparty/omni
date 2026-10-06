import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { AGENTS, coverage, type AgentEntry } from './agents'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import {
  baseChatAttemptsIn,
  estimateAgent,
  priceAgainstBase,
  type AgentEstimate,
  type EstimateFn,
} from './planCost'

// The sweep's entry point, skeleton only. Everything here is a pure
// function over the registry so the trigger track can test selection without
// running an agent, and so `--dry-run` can answer "what would this cost me"
// before anything is spent.

export type AgentSelector =
  | { kind: 'all' }
  // Whichever agents the branch touched. Needs a diff against the base ref,
  // which belongs to the trigger track — see selectAgents.
  | { kind: 'auto' }
  | { kind: 'list'; ids: string[] }

export const parseAgentSelector = (input: string): AgentSelector => {
  const value = input.trim()
  if (value === '' || value === 'auto') return { kind: 'auto' }
  if (value === 'all') return { kind: 'all' }
  // Deduped: `/judge cos,cos` would otherwise sweep the same agent twice and
  // bill for both.
  const ids = [
    ...new Set(
      value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== ''),
    ),
  ]
  return { kind: 'list', ids }
}

export interface Selection {
  selected: AgentEntry[]
  // Ids asked for that are not in the registry. Named back rather than
  // ignored: a typo in a PR comment should say so, not silently run nothing.
  unknown: string[]
  // Asked for, real, but not judgeable yet. Reported with the reason.
  blocked: AgentEntry[]
}

export const selectAgents = (
  selector: AgentSelector,
  agents: readonly AgentEntry[] = AGENTS,
): Selection => {
  if (selector.kind === 'auto') {
    throw new Error(
      'auto selection is not implemented in the skeleton: it needs a diff ' +
        'against the PR base ref, which the trigger owns',
    )
  }
  const requested =
    selector.kind === 'all'
      ? agents
      : selector.ids.map((id) => agents.find((a) => a.agentId === id) ?? id)

  const unknown = requested.filter((a): a is string => typeof a === 'string')
  const found = requested.filter((a): a is AgentEntry => typeof a !== 'string')

  return {
    selected: found.filter((a) => a.status !== 'blocked'),
    unknown,
    blocked: found.filter((a) => a.status === 'blocked'),
  }
}

// Takes the registry explicitly rather than reading the global one, so the
// coverage line always describes the same set the selection came from. The
// default made it right by coincidence in production and wrong anywhere else,
// including in its own test.
//
// A row carries its price as `cents: <n> (<basis>)` ahead of the case list,
// which stays last because the workflow reads it as the rest of the line. The
// workflow sums those cents and refuses when it cannot read one from every row.
export const formatPlan = (
  selection: Selection,
  agents: readonly AgentEntry[] = AGENTS,
  estimate: (agent: AgentEntry) => AgentEstimate = estimateAgent,
): string => {
  const { wired, placeholder, judgeable, blocked } = coverage(agents)
  const lines: string[] = []

  lines.push(`Universal Judge — plan (${selection.selected.length} agents)`)
  lines.push('')
  for (const agent of selection.selected) {
    const cases = agent.cases ?? 'NO CASE LIST YET'
    const { cents, basis, why } = estimate(agent)
    lines.push(
      `  ${agent.agentId}  [${agent.shape}]  cents: ${cents} (${basis})  cases: ${cases}`,
    )
    lines.push(`      ${why}`)
  }
  if (selection.blocked.length > 0) {
    lines.push('')
    lines.push('  skipped, not judgeable yet:')
    for (const agent of selection.blocked) {
      lines.push(`    ${agent.agentId} — ${agent.blockedReason ?? ''}`)
    }
  }
  if (selection.unknown.length > 0) {
    lines.push('')
    lines.push(`  unknown agent ids: ${selection.unknown.join(', ')}`)
  }
  lines.push('')
  const notes = [
    ...(placeholder > 0 ? [`${placeholder} on placeholder inputs`] : []),
    ...(blocked.length > 0 ? [`${blocked.length} blocked`] : []),
  ]
  lines.push(
    `coverage: ${wired} of ${judgeable} agents wired` +
      (notes.length > 0 ? ` (${notes.join(', ')})` : ''),
  )
  return lines.join('\n')
}

export interface CliArgs {
  agents: AgentSelector
  dryRun: boolean
  // The base ref's planCost.ts, placed beside this one so its imports resolve
  // here, and its config.ts. Given by the workflow; a local run prices from
  // this branch alone.
  basePlanCost?: string
  baseConfig?: string
}

export const parseArgs = (argv: string[]): CliArgs => {
  const flag = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
  return {
    agents: parseAgentSelector(flag('agents') ?? 'auto'),
    dryRun: argv.includes('--dry-run'),
    basePlanCost: flag('base-plan-cost'),
    baseConfig: flag('base-config'),
  }
}

export interface BasePricing {
  estimate: EstimateFn | undefined
  chatAttempts: number | undefined
}

const BaseModuleSchema = z.object({
  estimateAgent: z.custom<EstimateFn>((value) => typeof value === 'function'),
})

// Anything that goes wrong here leaves that half undefined, and pricing then
// fails closed: see priceAgainstBase.
export const loadBasePricing = async (
  planCostPath: string | undefined,
  configPath: string | undefined,
): Promise<BasePricing> => {
  let estimate: EstimateFn | undefined
  try {
    estimate =
      planCostPath === undefined
        ? undefined
        : BaseModuleSchema.parse(await import(planCostPath)).estimateAgent
  } catch {
    estimate = undefined
  }
  let chatAttempts: number | undefined
  try {
    chatAttempts =
      configPath === undefined
        ? undefined
        : baseChatAttemptsIn(readFileSync(configPath, 'utf8'))
  } catch {
    chatAttempts = undefined
  }
  return { estimate, chatAttempts }
}

// Each arm walks its own attempts, so chat is priced at the larger.
export const pricingConfig = (
  chatAttempts: number | undefined,
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
): JudgeConfig => ({
  ...config,
  attemptsPerCase: Math.max(config.attemptsPerCase, chatAttempts ?? 0),
})

export interface CliResult {
  plan: string
  // Non-zero when the request itself was malformed — an id that is not an
  // agent. Reported as a status rather than thrown, so the plan still
  // prints, and surfaced here rather than left for a caller to grep out of
  // the prose: a workflow parsing this output to price a sweep would
  // otherwise under-report it, or sweep nothing and go green.
  exitCode: number
}

// A sweep is three processes, not one, so this CLI cannot run it. The arms
// are two vitest invocations in two worktrees — `useTestService()` registers
// hooks that only exist inside vitest — and the judging is `sweep.ts` under
// tsx. Whoever drives the sweep drives those three in order; see judge.yml.
//
// So `run` stays the planner. That is not the placeholder it used to be: the
// workflow's cost estimate parses this plan before anything is spent, and the
// plan is the only thing here that can be produced without a database, a
// model or a second checkout.
export const SWEEP_IS_NOT_ONE_COMMAND =
  'the judge CLI plans a sweep; it does not run one. A sweep is three ' +
  'processes: src/chats/evals/judge/sweep.eval.test.ts under vitest in the ' +
  'base worktree (JUDGE_ARM=base), the same suite in the candidate ' +
  'worktree (JUDGE_ARM=candidate), then src/chats/evals/judge/sweep.ts ' +
  'under tsx to judge both arms. The arms cannot share a process because ' +
  'two worktrees are two module graphs. See .github/workflows/judge.yml.'

export const run = (
  argv: string[],
  agents: readonly AgentEntry[] = AGENTS,
  base?: BasePricing,
): CliResult => {
  const args = parseArgs(argv)
  const selection = selectAgents(args.agents, agents)
  if (!args.dryRun) {
    throw new Error(SWEEP_IS_NOT_ONE_COMMAND)
  }
  const config = pricingConfig(base?.chatAttempts)
  // Asked to compare against a base and handed none is the same as a base
  // that would not load: priced at the worst case.
  const estimate =
    args.basePlanCost === undefined && base === undefined
      ? (agent: AgentEntry) => estimateAgent(agent, config)
      : priceAgainstBase(base?.estimate, config)
  return {
    plan: formatPlan(selection, agents, estimate),
    exitCode: selection.unknown.length > 0 ? 1 : 0,
  }
}

// Entry point. Without this the module exports `run` and never calls it, so
// `npx tsx cli.ts --agents=all --dry-run` prints nothing and exits 0 — which
// is how a workflow that shells out to this file goes green having done
// nothing, and how a local smoke test that imports `run` directly proves the
// function works while proving nothing about the command.
//
// `require.main === module` is the house pattern here (see scripts/), and gp-api
// is CommonJS, so import.meta is not available.
if (require.main === module) {
  const argv = process.argv.slice(2)
  const args = parseArgs(argv)
  void loadBasePricing(args.basePlanCost, args.baseConfig)
    .then((base) => {
      const result = run(
        argv,
        AGENTS,
        args.basePlanCost === undefined ? undefined : base,
      )
      console.log(result.plan)
      process.exitCode = result.exitCode
    })
    .catch((err: Error) => {
      console.error(err.message)
      process.exitCode = 1
    })
}
