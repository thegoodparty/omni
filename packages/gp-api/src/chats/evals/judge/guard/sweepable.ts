import { findAgent, type AgentEntry } from '../agents'
import { CaseListError, loadCaseList } from '../cases'

// Which of the guard's agents a judge sweep can actually run, decided by the
// same checks the sweep path refuses on: selectAgents (cli.ts) skips a
// blocked agent, and loadCaseList throws CaseListError for an agent with no
// readable case list, which judge.yml's plan step reads as "NO CASE LIST YET"
// and neither prices nor sweeps. Dispatching such an agent anyway only came
// back as an infra error (compliance_setup on PR #3722, six pushes running).
export type UnsweepableReason = 'not_registered' | 'blocked' | 'no_case_list'

export interface UnsweepableAgent {
  readonly agentId: string
  readonly reason: UnsweepableReason
}

export interface SweepableSplit {
  readonly sweepable: readonly string[]
  readonly unsweepable: readonly UnsweepableAgent[]
}

const hasReadableCaseList = (agent: AgentEntry): boolean => {
  try {
    loadCaseList(agent)
    return true
  } catch (err) {
    if (err instanceof CaseListError) return false
    throw err
  }
}

export const unsweepableReason = (
  agentId: string,
): UnsweepableReason | undefined => {
  const agent = findAgent(agentId)
  if (agent === undefined) return 'not_registered'
  if (agent.status === 'blocked') return 'blocked'
  return hasReadableCaseList(agent) ? undefined : 'no_case_list'
}

export const splitSweepable = (
  agentIds: readonly string[],
  reasonFor: (
    agentId: string,
  ) => UnsweepableReason | undefined = unsweepableReason,
): SweepableSplit => {
  const sweepable: string[] = []
  const unsweepable: UnsweepableAgent[] = []
  for (const agentId of agentIds) {
    const reason = reasonFor(agentId)
    if (reason === undefined) sweepable.push(agentId)
    else unsweepable.push({ agentId, reason })
  }
  return { sweepable, unsweepable }
}

const REASON_TEXT: Readonly<Record<UnsweepableReason, string>> = {
  not_registered: 'not in the agent registry',
  blocked: 'blocked from judging',
  no_case_list: 'no case list',
}

// Leading space included, so a caller appends it to a sentence as is.
export const unsweepableNote = (
  unsweepable: readonly UnsweepableAgent[],
): string =>
  unsweepable.length === 0
    ? ''
    : ` Not swept, because the judge cannot sweep them: ${unsweepable
        .map((a) => `\`${a.agentId}\` (${REASON_TEXT[a.reason]})`)
        .join(', ')}.`
