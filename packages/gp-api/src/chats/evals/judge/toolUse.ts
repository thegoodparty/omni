import type { Arm, RunRecord } from './record'
import { publicToolName } from './toolErrorDetails'

// Tool names only, never arguments or queries: this lands on a public page.
export interface ToolCount {
  // Runs that called the tool at least once.
  called: number
  // Runs in which at least one call to the tool failed.
  errored: number
}

export interface ArmToolUse {
  // Produced or blocked runs. An infraError run is counted apart because its
  // trace is not an agent result.
  runs: number
  infraErrors: number
  tools: Record<string, ToolCount>
}

export interface CaseToolUse {
  caseId: string
  base: ArmToolUse
  candidate: ArmToolUse
}

export interface AgentToolUse {
  agentId: string
  cases: readonly CaseToolUse[]
}

const armToolUse = (records: readonly RunRecord[]): ArmToolUse => {
  const tools: Record<string, ToolCount> = {}
  let runs = 0
  let infraErrors = 0
  for (const record of records) {
    if (record.status === 'infraError') {
      infraErrors += 1
      continue
    }
    runs += 1
    const called = new Set<string>()
    const errored = new Set<string>()
    for (const step of record.trace) {
      if (step.kind !== 'tool' || step.tool === undefined) continue
      // The trace keeps whatever name the model asked for, registered or not.
      const tool = publicToolName(step.tool, 'chat')
      called.add(tool)
      if (step.error !== undefined) errored.add(tool)
    }
    for (const tool of called) {
      const count = tools[tool] ?? { called: 0, errored: 0 }
      count.called += 1
      if (errored.has(tool)) count.errored += 1
      tools[tool] = count
    }
  }
  return { runs, infraErrors, tools }
}

// Every case with a record on either arm, paired or not: a case only one arm
// ran is usually a new one, and that is the case a reader wants to see.
export const chatToolUse = (
  agentIds: readonly string[],
  records: readonly RunRecord[],
): AgentToolUse[] =>
  agentIds.flatMap((agentId) => {
    const forAgent = records.filter(
      (r) => r.agentId === agentId && r.agentShape === 'chat',
    )
    if (forAgent.length === 0) return []
    const caseIds = [...new Set(forAgent.map((r) => r.caseId))].sort()
    const arm = (caseId: string, which: Arm): ArmToolUse =>
      armToolUse(forAgent.filter((r) => r.caseId === caseId && r.arm === which))
    return [
      {
        agentId,
        cases: caseIds.map((caseId) => ({
          caseId,
          base: arm(caseId, 'base'),
          candidate: arm(caseId, 'candidate'),
        })),
      },
    ]
  })
