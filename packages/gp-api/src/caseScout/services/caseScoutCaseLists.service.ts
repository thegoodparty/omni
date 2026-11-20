import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'

const CASE_LIST_URL =
  'https://raw.githubusercontent.com/thegoodparty/omni/main/' +
  'packages/gp-api/src/chats/evals/judge/cases'
const FETCH_TIMEOUT_MS = 15_000

// About 25 cases per chat agent's list (Implementation Notes 2.8).
export const LIST_SOFT_CAP = 25

export type CaseListInfo = {
  agentId: string
  caseCount: number
  caseIds: Set<string>
  conditions: string[]
  fixtureDescription: string
}

export const emptyCaseList = (agentId: string): CaseListInfo => ({
  agentId,
  caseCount: 0,
  caseIds: new Set(),
  conditions: [],
  fixtureDescription: '',
})

const CaseListFileSchema = z.object({
  note: z.string().optional().catch(undefined),
  cases: z.array(
    z.object({
      caseId: z.string().optional().catch(undefined),
      condition: z.string().optional().catch(undefined),
    }),
  ),
})

// Reads cases/<agentId>.json off main, unauthenticated: omni is public, so no
// credential is needed, and this process must never hold a write-capable
// GitHub key (it reads transcripts).
@Injectable()
export class CaseScoutCaseListsService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(CaseScoutCaseListsService.name)
  }

  async read(agentId: string): Promise<CaseListInfo> {
    const response = await fetch(`${CASE_LIST_URL}/${agentId}.json`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`case list ${agentId} answered HTTP ${response.status}`)
    }
    const file = CaseListFileSchema.parse(await response.json())
    return {
      agentId,
      caseCount: file.cases.length,
      caseIds: new Set(file.cases.flatMap((c) => (c.caseId ? [c.caseId] : []))),
      conditions: file.cases.flatMap((c) => (c.condition ? [c.condition] : [])),
      fixtureDescription: file.note ?? '',
    }
  }

  // A GitHub hiccup costs tonight's drafts their view of the existing
  // conditions, not the drafts themselves, as in the Python reader. The run
  // record lists the miss.
  async readOrEmpty(agentId: string, errors: string[]): Promise<CaseListInfo> {
    try {
      return await this.read(agentId)
    } catch (err) {
      this.logger.warn(
        { err, agentId },
        'Case scout could not read a case list',
      )
      errors.push(`case list ${agentId} could not be read`)
      return emptyCaseList(agentId)
    }
  }
}
