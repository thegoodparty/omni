import { AGENTS, coverage, type AgentEntry } from './agents'

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
export const formatPlan = (
  selection: Selection,
  agents: readonly AgentEntry[] = AGENTS,
): string => {
  const { wired, judgeable, blocked } = coverage(agents)
  const lines: string[] = []

  lines.push(`Universal Judge — plan (${selection.selected.length} agents)`)
  lines.push('')
  for (const agent of selection.selected) {
    const cases = agent.cases ?? 'NO CASE LIST YET'
    lines.push(`  ${agent.agentId}  [${agent.shape}]  cases: ${cases}`)
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
  lines.push(
    `coverage: ${wired} of ${judgeable} agents wired` +
      (blocked.length > 0 ? ` (${blocked.length} blocked)` : ''),
  )
  return lines.join('\n')
}

export interface CliArgs {
  agents: AgentSelector
  dryRun: boolean
}

export const parseArgs = (argv: string[]): CliArgs => {
  const agentsFlag = argv.find((a) => a.startsWith('--agents='))
  return {
    agents: parseAgentSelector(agentsFlag?.split('=')[1] ?? 'auto'),
    dryRun: argv.includes('--dry-run'),
  }
}

export const run = (
  argv: string[],
  agents: readonly AgentEntry[] = AGENTS,
): string => {
  const args = parseArgs(argv)
  const plan = formatPlan(selectAgents(args.agents, agents), agents)
  if (args.dryRun) return plan
  throw new Error(
    'only --dry-run is implemented: the runners, the judge and the report ' +
      'land in their own tracks',
  )
}
