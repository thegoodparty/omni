import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { AGENTS, type AgentEntry } from './agents'
import { loadBackgroundCases } from './cases'
import { selectAgents } from './cli'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import { agentConfigFor } from './runners/agentConfig'
import {
  ARM_BUDGET_MS,
  admitBackground,
  pollTimeoutMsFor,
} from './runners/backgroundDispatch'

// THE BACKGROUND BUDGET, AND WHICH AGENTS IT ADMITS, DECIDED ONCE FOR BOTH
// ARMS.
//
// Both live behind a per-worktree read. The budget is a constant in
// config.ts; which agents fit depends on each agent's timeout, read from its
// manifest. The base arm runs the base ref's copy of both from its own
// worktree, so two arms deciding for themselves disagree whenever a branch
// changes either — and with the budget spent down in walk order, one
// disagreement moves every agent after it. judge.yml runs this once, after
// the base worktree exists and before either arm, and both arms obey it.
//
// The CANDIDATE's budget, because the sweep is a question about the
// candidate. But the LARGER of the two arms' costs per agent, because an
// agent has to fit on whichever arm is slower.

const TIMEOUT_ONLY = z.object({ timeout_seconds: z.number() })
const CASES_ONLY = z.object({ cases: z.array(z.unknown()) })

// The base ref's two facts, read raw. See pollTimeoutMsFor for why raw.
const baseCost = (
  baseDir: string,
  agent: AgentEntry,
  config: JudgeConfig,
): number | undefined => {
  try {
    const manifest = TIMEOUT_ONLY.parse(
      JSON.parse(
        readFileSync(
          join(
            baseDir,
            'packages/runbooks/experiments',
            agent.agentId,
            'manifest.json',
          ),
          'utf8',
        ),
      ),
    )
    const list = CASES_ONLY.parse(
      JSON.parse(
        readFileSync(
          join(
            baseDir,
            'packages/gp-api/src/chats/evals/judge/cases',
            agent.cases ?? '',
          ),
          'utf8',
        ),
      ),
    )
    const count = Math.min(
      list.cases.length,
      config.background.maxCases ?? list.cases.length,
    )
    return (
      count *
      config.background.attemptsPerCase *
      pollTimeoutMsFor(manifest.timeout_seconds)
    )
  } catch {
    return undefined
  }
}

const candidateCost = (agent: AgentEntry, config: JudgeConfig): number => {
  const { timeout_seconds } = TIMEOUT_ONLY.parse(
    JSON.parse(agentConfigFor(agent.agentId).manifest),
  )
  const all = loadBackgroundCases(agent).length
  const count = Math.min(all, config.background.maxCases ?? all)
  return (
    count *
    config.background.attemptsPerCase *
    pollTimeoutMsFor(timeout_seconds)
  )
}

export const resolveAdmission = (
  agentIds: readonly string[],
  baseDir: string,
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
  registry: readonly AgentEntry[] = AGENTS,
  costs: {
    candidate: (agent: AgentEntry, config: JudgeConfig) => number
    base: (
      baseDir: string,
      agent: AgentEntry,
      config: JudgeConfig,
    ) => number | undefined
  } = { candidate: candidateCost, base: baseCost },
) =>
  admitBackground(
    selectAgents({ kind: 'list', ids: [...agentIds] }, registry).selected,
    (agent) => {
      // PER AGENT, the way captureArm isolates them. One agent with no case
      // list, or a manifest this branch cannot parse, must be refused by name
      // — not throw, which would fail this step and with it every chat agent
      // in the sweep.
      if (agent.cases === null) {
        return { refused: 'has no case list, so it has no inputs to compare' }
      }
      let onCandidate: number
      try {
        onCandidate = costs.candidate(agent, config)
      } catch (err) {
        return {
          refused:
            'cannot be read on this branch: ' +
            (err instanceof Error ? err.message : String(err)),
        }
      }
      const onBase = costs.base(baseDir, agent, config)
      if (onBase === undefined) {
        return {
          refused:
            'is not on the base ref, or its manifest or case list there ' +
            'cannot be read, so there is no base arm to compare it against',
        }
      }
      return { ms: Math.max(onCandidate, onBase) }
    },
    ARM_BUDGET_MS,
  )

// Lines for $GITHUB_OUTPUT. An absent cap prints `max_cases=` — blank, which
// sweepEnv reads as "no cap" because attempts is present. An empty admitted
// list prints `admitted=` — blank, which sweepEnv reads as NONE admitted for
// the same reason, rather than as "not decided".
export const budgetOutputLines = (
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
  admitted: readonly string[] = [],
): string =>
  `attempts=${config.background.attemptsPerCase}\n` +
  `max_cases=${config.background.maxCases ?? ''}\n` +
  `admitted=${admitted.join(',')}\n`

// gp-api is CommonJS, so `require.main` is the house pattern — see
// dataVersion.ts and sweep.ts.
//
// FAILS HARD, unlike dataVersion.ts. The mart resolver can legitimately fail
// on the network and the sweep is still worth running unpinned; this reads
// files from the two checkouts, so a failure means the judge code is broken
// and the arms would fail anyway — and it runs before either arm, so
// failing here costs nothing.
if (require.main === module) {
  const outPath = process.argv[2]
  const baseDir = process.env.BASE_DIR
  const agentIds = (process.env.JUDGE_AGENTS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '')
  if (outPath === undefined || outPath === '' || !baseDir) {
    process.stderr.write(
      'usage: BASE_DIR=<base worktree> JUDGE_AGENTS=<ids> armBudget.ts ' +
        '<path to append outputs to>\n',
    )
    process.exit(2)
  }
  const { admitted, refused } = resolveAdmission(agentIds, baseDir)
  appendFileSync(outPath, budgetOutputLines(DEFAULT_JUDGE_CONFIG, admitted))
  const budget = DEFAULT_JUDGE_CONFIG.background
  process.stderr.write(
    `both arms will walk background agents at ${budget.attemptsPerCase} ` +
      `attempt(s) over ${budget.maxCases ?? 'every'} case(s); admitted: ` +
      `${admitted.join(', ') || 'none'}\n`,
  )
  for (const one of refused) {
    process.stderr.write(`refused ${one.agentId}: ${one.reason}\n`)
  }
}
