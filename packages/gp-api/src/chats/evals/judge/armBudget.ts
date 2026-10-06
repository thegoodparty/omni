import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { AGENTS, type AgentEntry } from './agents'
import { loadBackgroundCases, loadCaseList, type CaseList } from './cases'
import { selectAgents } from './cli'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import { BASE_CHAT_ATTEMPTS, baseChatAttemptsIn } from './planCost'
import { agentConfigFor } from './runners/agentConfig'
import {
  ARM_BUDGET_MS,
  admitBackground,
  chatTurnsIn,
  pollTimeoutMsFor,
  refuseChat,
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

// What one arm would walk for an agent: how many runs, how long one run may
// take, and WHICH cases. The ids matter because cases pair by id and each arm caps its own list — a
// branch that inserts or reorders a case near the top of a list has each arm
// take a different first few, and every one of them is a paid run pairing
// with nothing.
export interface ArmWalk {
  runs: number
  runMs: number
  caseIds: readonly string[]
}
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
): ArmWalk | undefined => {
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
    return {
      runs: count * config.background.attemptsPerCase,
      runMs: pollTimeoutMsFor(manifest.timeout_seconds),
      caseIds: list.cases.slice(0, count).map((one) => one.caseId),
    }
  } catch {
    return undefined
  }
}

// WHETHER THE BASE ARM WILL OBEY THIS AT ALL.
//
// A base ref older than shared admission ignores every value this step
// writes and walks background agents at its own budget — which, before the
// background budget existed, refuses every one of them. The candidate would
// still walk what this step admits, and that is a paid Fargate run on one arm pairing with nothing on the other, for every
// admitted agent, on every PR opened against such a base.
//
// So the base tree is asked first: if its arm does not read the admitted
// list, nothing is admitted and every agent is refused by name. A source probe
// rather than a version number because the arm's env schema is the contract;
// if a refactor moves it, this refuses everything, which costs a sweep and
// bills nothing.
//
// THE SCHEMA KEY, not the name anywhere. The arm reads its environment
// through one zod object whose keys are written `  JUDGE_X: Schema,`, and only
// a key there means the arm reads the variable. Today's main already carries
// fifteen `JUDGE_` keys, so a looser probe — the prefix, or the name appearing
// in a comment or an error list — would pass against the very base it exists
// to refuse.
export const BASE_HONOURS_ADMISSION = /^\s*JUDGE_BACKGROUND_ADMITTED:/m

export const baseHonoursAdmission = (baseDir: string): boolean => {
  try {
    return BASE_HONOURS_ADMISSION.test(
      readFileSync(
        join(baseDir, 'packages/gp-api/src/chats/evals/judge/sweepEnv.ts'),
        'utf8',
      ),
    )
  } catch {
    return false
  }
}

// WHETHER THE BASE ARM STARTS ITS BACKGROUND RUNS ALL AT ONCE, which is what
// admission by the wave assumes. A base that honours admission but predates
// that walks its runs one after another, and a wave sized for twelve slots
// would take it twelve runs' worth of wall clock. Against such a base,
// admission falls back to the one-after-another spend-down it can honour.
//
// The exported constant, anchored, for the reason the admission probe reads
// the schema key: a looser match finds the name in a comment.
export const BASE_WALKS_CONCURRENTLY =
  /^export const BACKGROUND_WALKS_CONCURRENTLY = true$/m

export const baseWalksConcurrently = (baseDir: string): boolean => {
  try {
    return BASE_WALKS_CONCURRENTLY.test(
      readFileSync(
        join(baseDir, 'packages/gp-api/src/chats/evals/judge/sweepArm.ts'),
        'utf8',
      ),
    )
  } catch {
    return false
  }
}

// WHETHER THE BASE ARM REFUSES THE CHAT AGENTS IT IS TOLD TO. Probed for the
// reason the two above are, and anchored for the same reason.
export const BASE_BOUNDS_CHAT = /^export const CHAT_TIME_BOUNDED = true$/m

export const baseBoundsChat = (baseDir: string): boolean => {
  try {
    return BASE_BOUNDS_CHAT.test(
      readFileSync(
        join(
          baseDir,
          'packages/gp-api/src/chats/evals/judge/runners/backgroundDispatch.ts',
        ),
        'utf8',
      ),
    )
  } catch {
    return false
  }
}

// A chat list's turns, read raw for the reason baseCost is: a case of
// several `turns` drives each one, and a `question` case — every list before
// `turns` existed — drives one.
const CHAT_TURNS_ONLY = z.object({
  cases: z.array(z.object({ turns: z.array(z.string()).optional() })),
})

const warnLine = (line: string): void => {
  process.stderr.write(`${line}\n`)
}

// How many turns a chat agent's list drives per attempt on the base ref.
// Undefined when there is none, and the candidate's count stands.
//
// A list that is there but will not parse here is warned about rather than
// refused: the base arm reads it with its own parser, which may accept it
// and walk every case, so the candidate's count can then be low.
const baseChatTurns = (
  baseDir: string,
  agent: AgentEntry,
  warn: (line: string) => void = warnLine,
): number | undefined => {
  let text: string
  try {
    text = readFileSync(
      join(
        baseDir,
        'packages/gp-api/src/chats/evals/judge/cases',
        agent.cases ?? '',
      ),
      'utf8',
    )
  } catch {
    return undefined
  }
  try {
    return CHAT_TURNS_ONLY.parse(JSON.parse(text)).cases.reduce(
      (sum, one) => sum + (one.turns?.length ?? 1),
      0,
    )
  } catch {
    warn(
      `the base ref's case list for ${agent.agentId} could not be read, so ` +
        "its chat time is planned at this branch's count alone",
    )
    return undefined
  }
}

// What this branch's own list drives. A seam so the default is tested.
export const candidateChatTurns = (
  agent: AgentEntry,
  load: (agent: AgentEntry) => CaseList = loadCaseList,
): number => chatTurnsIn(load(agent))

// The base arm's chat attempts per case, which it reads from ITS config.ts.
// Undefined when it cannot be found, and the candidate's then stands. The
// pattern lives in planCost.ts, which prices the same max.
export { BASE_CHAT_ATTEMPTS }

export const baseChatAttempts = (baseDir: string): number | undefined => {
  try {
    return baseChatAttemptsIn(
      readFileSync(
        join(baseDir, 'packages/gp-api/src/chats/evals/judge/config.ts'),
        'utf8',
      ),
    )
  } catch {
    return undefined
  }
}

// THE CHAT AGENTS NEITHER ARM MAY WALK, decided once for the reason
// background admission is: each arm reads its own case lists and its own
// attempts, and two arms refusing different agents pay for turns that pair
// with nothing. Each agent is costed at the larger turn count and the larger
// attempts of the two arms, which bounds whichever arm is slower.
//
// Against a base that would not obey, nothing is refused, which leaves the
// sweep exactly as unbounded as that base already was.
type ChatCosts = {
  candidate: (agent: AgentEntry) => number
  base: (
    baseDir: string,
    agent: AgentEntry,
    warn: (line: string) => void,
  ) => number | undefined
  baseAttempts: (baseDir: string) => number | undefined
  boundsChat: (baseDir: string) => boolean
}

export const CHAT_COSTS: ChatCosts = {
  candidate: candidateChatTurns,
  base: baseChatTurns,
  baseAttempts: baseChatAttempts,
  boundsChat: baseBoundsChat,
}

export const resolveChatRefusals = (
  agentIds: readonly string[],
  baseDir: string,
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
  registry: readonly AgentEntry[] = AGENTS,
  costs: ChatCosts = CHAT_COSTS,
  warn: (line: string) => void = warnLine,
): { agentId: string; reason: string }[] => {
  if (!costs.boundsChat(baseDir)) return []
  const selected = selectAgents(
    { kind: 'list', ids: [...new Set(agentIds)] },
    registry,
  ).selected
  const baseAttempts = costs.baseAttempts(baseDir)
  // Warned rather than refused: a base that walks more attempts than this
  // branch is then planned low.
  if (baseAttempts === undefined) {
    warn(
      "the base ref's chat attempts per case could not be read from its " +
        "config.ts, so this branch's are used for both arms",
    )
  }
  const attempts = Math.max(config.attemptsPerCase, baseAttempts ?? 0)
  // Zero when this branch cannot read the list: the arm reports the real
  // error by name, and this is only a time estimate.
  const onCandidate = (agent: AgentEntry): number => {
    try {
      return costs.candidate(agent)
    } catch {
      return 0
    }
  }
  return refuseChat(
    selected,
    (agent) =>
      Math.max(onCandidate(agent), costs.base(baseDir, agent, warn) ?? 0) *
      attempts,
    ARM_BUDGET_MS,
  )
}

const candidateCost = (agent: AgentEntry, config: JudgeConfig): ArmWalk => {
  const { timeout_seconds } = TIMEOUT_ONLY.parse(
    JSON.parse(agentConfigFor(agent.agentId).manifest),
  )
  const all = loadBackgroundCases(agent)
  const capped =
    config.background.maxCases === undefined
      ? all
      : all.slice(0, config.background.maxCases)
  return {
    runs: capped.length * config.background.attemptsPerCase,
    runMs: pollTimeoutMsFor(timeout_seconds),
    caseIds: capped.map((one) => one.caseId),
  }
}

export const resolveAdmission = (
  agentIds: readonly string[],
  baseDir: string,
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
  registry: readonly AgentEntry[] = AGENTS,
  costs: {
    candidate: (agent: AgentEntry, config: JudgeConfig) => ArmWalk
    base: (
      baseDir: string,
      agent: AgentEntry,
      config: JudgeConfig,
    ) => ArmWalk | undefined
    honoursAdmission: (baseDir: string) => boolean
    walksConcurrently: (baseDir: string) => boolean
  } = {
    candidate: candidateCost,
    base: baseCost,
    honoursAdmission: baseHonoursAdmission,
    walksConcurrently: baseWalksConcurrently,
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
      let onCandidate: ArmWalk
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
      // THE SAME CASES ON BOTH ARMS, or none of it is worth paying for. Cases
      // pair by id, so a case only one arm walks is a paid run with no
      // partner. Compared as sets: the same ids in a different order still
      // pair.
      // A repeated id on either side is refused by name: the arm's own loader
      // rejects one, so that arm would fail on this agent after the other had
      // paid — and a set comparison alone cannot see a duplicate.
      for (const [arm, ids] of [
        ['base', onBase.caseIds],
        ['candidate', onCandidate.caseIds],
      ] as const) {
        if (new Set(ids).size !== ids.length) {
          return {
            refused: `has a repeated case id on the ${arm} arm, which its own loader refuses`,
          }
        }
      }
      const onlyBase = onBase.caseIds.filter(
        (id) => !onCandidate.caseIds.includes(id),
      )
      const onlyCandidate = onCandidate.caseIds.filter(
        (id) => !onBase.caseIds.includes(id),
      )
      if (onlyBase.length > 0 || onlyCandidate.length > 0) {
        return {
          refused:
            'would walk different cases on the two arms — the base ref has ' +
            `[${onlyBase.join(', ')}] where this branch has ` +
            `[${onlyCandidate.join(', ')}] — so those runs would be paid for ` +
            'and pair with nothing; this happens when a branch adds or ' +
            'reorders a case near the top of the list',
        }
      }
      // The larger on each count. Equal case ids and one attempt count make
      // the runs equal; the max costs nothing and does not rely on it.
      return {
        runs: Math.max(onCandidate.runs, onBase.runs),
        runMs: Math.max(onCandidate.runMs, onBase.runMs),
        caseIds: onCandidate.caseIds,
      }
    },
    ARM_BUDGET_MS,
    costs.walksConcurrently(baseDir)
      ? config.background.maxInFlight
      : undefined,
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
  const agentIds = parseAgentIds(process.env.JUDGE_AGENTS ?? '')
  const background = resolveAdmission(agentIds, baseDir)
  const admitted = background.admitted
  // One map for both shapes, which the arms already carry: a background
  // agent is refused by its absence from `admitted`, a chat one by its name
  // here.
  const refused = [
    ...background.refused,
    ...resolveChatRefusals(agentIds, baseDir),
  ]
  if (!baseBoundsChat(baseDir)) {
    process.stderr.write(
      "the base ref's arm does not refuse chat agents, so none are refused " +
        'and the chat half of each arm is unbounded\n',
    )
  }
  appendFileSync(
    outPath,
    budgetOutputLines(DEFAULT_JUDGE_CONFIG, admitted, refused, ARM_BUDGET_MS),
  )
  const budget = DEFAULT_JUDGE_CONFIG.background
  process.stderr.write(
    `both arms will walk background agents at ${budget.attemptsPerCase} ` +
      `attempt(s) over ${budget.maxCases ?? 'every'} case(s), ` +
      (baseWalksConcurrently(baseDir)
        ? `up to ${budget.maxInFlight} runs at once`
        : 'one run after another, as the base ref does') +
      `; admitted: ${admitted.join(', ') || 'none'}\n`,
  )
  for (const one of refused) {
    process.stderr.write(`refused ${one.agentId}: ${one.reason}\n`)
  }
}
