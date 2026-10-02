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
import { parseAgentIds } from './sweepEnv'

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
// Only the one field every case-list format has carried, because it is the key
// the two arms' cases pair on. Anything beyond it is the base ref's format to
// decide, and reading more of it here is how an older but valid list would get
// refused for its shape.
const CASES_ONLY = z.object({
  cases: z.array(z.object({ caseId: z.string() })),
})

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

// WHETHER THE BASE ARM WILL OBEY THIS AT ALL.
//
// A base ref older than shared admission ignores every value this step
// writes and walks background agents at its own budget — which, before the
// background budget existed, refuses every one of them. The candidate would
// still walk what this step admits, and once a fixture is minted that is a
// paid Fargate run on one arm pairing with nothing on the other, for every
// admitted agent, on every PR opened against such a base.
//
// So the base tree is asked first: if its arm does not read the admitted
// list, nothing is admitted and every agent is refused by name. A source probe
// rather than a version number because the arm's env schema is the contract;
// if a refactor moves it, this refuses everything, which costs a sweep and
// bills nothing.
export const BASE_HONOURS_ADMISSION = 'JUDGE_BACKGROUND_ADMITTED'

const baseHonoursAdmission = (baseDir: string): boolean => {
  try {
    return readFileSync(
      join(baseDir, 'packages/gp-api/src/chats/evals/judge/sweepEnv.ts'),
      'utf8',
    ).includes(BASE_HONOURS_ADMISSION)
  } catch {
    return false
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
    honoursAdmission: (baseDir: string) => boolean
  } = {
    candidate: candidateCost,
    base: baseCost,
    honoursAdmission: baseHonoursAdmission,
  },
): ReturnType<typeof admitBackground> => {
  // Deduplicated here as well as by the parser, keeping the first occurrence
  // as the arm's Set does, so a caller handing over a raw list still selects
  // exactly what the arm will walk.
  const selected = selectAgents(
    { kind: 'list', ids: [...new Set(agentIds)] },
    registry,
  ).selected
  if (!costs.honoursAdmission(baseDir)) {
    return {
      admitted: [],
      refused: selected
        .filter((agent) => agent.shape === 'background')
        .map((agent) => ({
          agentId: agent.agentId,
          reason:
            'the base ref predates shared background admission, so its arm ' +
            'would walk this agent at its own budget and refuse it, and ' +
            'nothing the candidate ran would pair; this clears once shared ' +
            'admission is on the base ref',
        })),
    }
  }
  return admitBackground(
    selected,
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
}

// Lines for $GITHUB_OUTPUT. An absent cap prints `max_cases=` — blank, which
// sweepEnv reads as "no cap" because attempts is present. An empty admitted
// list prints `admitted=` — blank, which sweepEnv reads as NONE admitted for
// the same reason, rather than as "not decided".
export const budgetOutputLines = (
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
  admitted: readonly string[] = [],
  refused: readonly { agentId: string; reason: string }[] = [],
  armBudgetMs: number = ARM_BUDGET_MS,
): string =>
  `attempts=${config.background.attemptsPerCase}\n` +
  `max_cases=${config.background.maxCases ?? ''}\n` +
  `admitted=${admitted.join(',')}\n` +
  // One line however much a reason says: JSON.stringify escapes any newline
  // inside one, and $GITHUB_OUTPUT reads a value to the end of its line.
  `refused=${JSON.stringify(Object.fromEntries(refused.map((one) => [one.agentId, one.reason])))}\n` +
  `arm_budget_ms=${armBudgetMs}\n`

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
  if (outPath === undefined || outPath === '' || !baseDir) {
    process.stderr.write(
      'usage: BASE_DIR=<base worktree> JUDGE_AGENTS=<ids> armBudget.ts ' +
        '<path to append outputs to>\n',
    )
    process.exit(2)
  }
  const { admitted, refused } = resolveAdmission(
    parseAgentIds(process.env.JUDGE_AGENTS ?? ''),
    baseDir,
  )
  appendFileSync(
    outPath,
    budgetOutputLines(DEFAULT_JUDGE_CONFIG, admitted, refused, ARM_BUDGET_MS),
  )
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
