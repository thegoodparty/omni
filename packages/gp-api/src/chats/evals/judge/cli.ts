import { readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { AGENTS, coverage, type AgentEntry } from './agents'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import {
  baseChatAttemptsIn,
  DEFAULT_SOURCES,
  estimateAgent,
  priceAgainstReferences,
  type AgentEstimate,
  type EstimateFn,
  type Reference,
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
  // `--reference=<planCost.ts>,<config.ts>,<cases dir>`, once per ref the
  // price is checked against: the PR's base ref and the default branch. The
  // planCost.ts sits beside this one so its imports resolve here. Given by
  // the workflow; a local run prices from this branch alone.
  references: string[]
}

export const parseArgs = (argv: string[]): CliArgs => {
  const flag = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
  return {
    agents: parseAgentSelector(flag('agents') ?? 'auto'),
    dryRun: argv.includes('--dry-run'),
    references: argv
      .filter((a) => a.startsWith('--reference='))
      .map((a) => a.slice('--reference='.length)),
  }
}

// What a ref's list for a chat agent drives: its turns, `absent` when the ref
// has no such list (an empty file: the workflow writes one on a 404), or
// `unread` when it was not fetched or cannot be read, which fails closed.
export type RefTurns = number | 'absent' | 'unread'

export interface LoadedReference extends Reference {
  chatTurns: (agent: AgentEntry) => RefTurns
}

export const UNREAD: LoadedReference = {
  estimate: undefined,
  chatAttempts: undefined,
  chatTurns: () => 'unread',
}

const ReferenceModuleSchema = z.object({
  estimateAgent: z.custom<EstimateFn>((value) => typeof value === 'function'),
})

// Read raw, the way armBudget.ts reads a base list: only the field that
// counts turns, so an older but valid list is not refused for its shape.
const TurnsOnlySchema = z.object({
  cases: z.array(z.object({ turns: z.array(z.string()).optional() })),
})

// Anything that goes wrong here leaves that part unread, and the price fails
// closed (see priceAgainstReferences). The one exception is a case list the
// ref does not have, which counts as this branch's, as armBudget.ts plans
// it, because a chat agent new on this branch has none there.
//
// The list is read at `<agentId>.json`, the name the workflow fetched it
// under, not at this branch's registry filename: a PR that pointed an agent
// at a new, shorter file would otherwise read as having none on the ref.
// chatCaseLists.test.ts pins every registry filename to that name, which
// also holds armBudget.ts's baseChatTurns, reading the base worktree under
// this branch's filename, to the right file.
export const loadReference = async (spec: string): Promise<LoadedReference> => {
  const [planCostPath, configPath, casesDir] = spec.split(',')
  if (!planCostPath || !configPath || !casesDir) return UNREAD
  let estimate: EstimateFn | undefined
  try {
    estimate = ReferenceModuleSchema.parse(
      await import(planCostPath),
    ).estimateAgent
  } catch {
    estimate = undefined
  }
  let chatAttempts: number | undefined
  try {
    chatAttempts = baseChatAttemptsIn(readFileSync(configPath, 'utf8'))
  } catch {
    chatAttempts = undefined
  }
  const chatTurns = (agent: AgentEntry): RefTurns => {
    // A file the workflow never wrote was never fetched, so nothing is
    // known about it.
    let text: string
    try {
      text = readFileSync(path.join(casesDir, `${agent.agentId}.json`), 'utf8')
    } catch {
      return 'unread'
    }
    if (text === '') return 'absent'
    try {
      return TurnsOnlySchema.parse(JSON.parse(text)).cases.reduce(
        (sum, one) => sum + (one.turns?.length ?? 1),
        0,
      )
    } catch {
      return 'unread'
    }
  }
  return { estimate, chatAttempts, chatTurns }
}

// Each arm walks its own attempts, so chat is priced at the largest.
export const pricingConfig = (
  chatAttempts: readonly (number | undefined)[],
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
): JudgeConfig => ({
  ...config,
  attemptsPerCase: Math.max(
    config.attemptsPerCase,
    ...chatAttempts.map((one) => one ?? 0),
  ),
})

// The longest list any ref's base arm could walk. When this branch's
// registry names a file other than `<agentId>.json`, the ref's list was read
// under the other name, so this branch's count is a floor for it too.
export const referenceTurns =
  (
    references: readonly LoadedReference[],
    candidateTurns: (agent: AgentEntry) => number = DEFAULT_SOURCES.countTurns,
  ) =>
  (agent: AgentEntry): number | undefined => {
    const found = references
      .map((one) => one.chatTurns(agent))
      .filter((turns): turns is number => typeof turns === 'number')
    if (agent.cases !== `${agent.agentId}.json`) {
      found.push(candidateTurns(agent))
    }
    return found.length === 0 ? undefined : Math.max(...found)
  }

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
  loaded?: readonly LoadedReference[],
): CliResult => {
  const args = parseArgs(argv)
  const selection = selectAgents(args.agents, agents)
  if (!args.dryRun) {
    throw new Error(SWEEP_IS_NOT_ONE_COMMAND)
  }
  // A reference asked for and not handed over is one that would not load.
  const references =
    loaded ?? args.references.map((): LoadedReference => UNREAD)
  const config = pricingConfig(references.map((one) => one.chatAttempts))
  const estimate = priceAgainstReferences(references, config, {
    baseTurns: referenceTurns(references),
  })
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
  void Promise.all(parseArgs(argv).references.map(loadReference))
    .then((references) => {
      const result = run(argv, AGENTS, references)
      console.log(result.plan)
      process.exitCode = result.exitCode
    })
    .catch((err: Error) => {
      console.error(err.message)
      process.exitCode = 1
    })
}
