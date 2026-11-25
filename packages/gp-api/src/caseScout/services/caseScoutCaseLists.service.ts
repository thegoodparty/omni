import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import {
  readSuiteCases,
  type SuiteCase,
  type SuiteCases,
} from '../util/suiteCases.util'

const MAIN_URL = 'https://raw.githubusercontent.com/thegoodparty/omni/main/'
const CASE_LIST_DIR = 'packages/gp-api/src/chats/evals/judge/cases'
const FETCH_TIMEOUT_MS = 15_000

// The pairwise suites the judge runs, by agent, from the repo root. Delegate
// appends the scout's cases to these, so they are what the drafter must see.
export const SUITE_PATHS: Record<string, string | undefined> = {
  campaign_assistant:
    'packages/gp-api/src/chats/general/campaign-manager/' +
    'campaign_assistant.eval.ts',
  chief_of_staff:
    'packages/gp-api/src/chats/general/chief-of-staff/chief_of_staff.eval.ts',
}

// About 25 cases per chat agent's list (Implementation Notes 2.8).
export const LIST_SOFT_CAP = 25

export type CaseCondition = { caseId: string; condition: string }

export type CaseListInfo = {
  agentId: string
  caseCount: number
  caseIds: Set<string>
  conditions: CaseCondition[]
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

type CaseListFile = z.infer<typeof CaseListFileSchema>

// The job and the quality bench both build an agent's list this way, so the
// bench drafts against what the job would see: ids from both sources, the
// suite's condition where both have one, the note from the JSON.
export const mergeCaseLists = (
  agentId: string,
  suiteCases: SuiteCase[],
  list: CaseListFile | undefined,
): CaseListInfo => {
  const listCases = list?.cases ?? []
  const caseIds = new Set([
    ...suiteCases.map((c) => c.caseId),
    ...listCases.flatMap((c) => (c.caseId ? [c.caseId] : [])),
  ])
  const conditions = new Map<string, string>()
  for (const c of suiteCases) {
    if (c.condition) conditions.set(c.caseId, c.condition)
  }
  for (const c of listCases) {
    if (c.caseId && c.condition && !conditions.has(c.caseId)) {
      conditions.set(c.caseId, c.condition)
    }
  }
  return {
    agentId,
    caseCount: caseIds.size,
    caseIds,
    conditions: [...conditions].map(([caseId, condition]) => ({
      caseId,
      condition,
    })),
    fixtureDescription: list?.note ?? '',
  }
}

const fetchText = async (path: string): Promise<string> => {
  const response = await fetch(`${MAIN_URL}${path}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`${path} answered HTTP ${response.status}`)
  }
  return response.text()
}

// Reads the judged suite and cases/<agentId>.json off main, unauthenticated:
// omni is public, so no credential is needed, and this process must never
// hold a write-capable GitHub key (it reads transcripts). The JSON still
// carries the fixture note, and its cases stand in when the suite is missing.
@Injectable()
export class CaseScoutCaseListsService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(CaseScoutCaseListsService.name)
  }

  async read(agentId: string, errors: string[] = []): Promise<CaseListInfo> {
    const suitePath = SUITE_PATHS[agentId]
    const [suiteResult, listResult] = await Promise.allSettled([
      suitePath === undefined
        ? Promise.resolve<SuiteCases | undefined>(undefined)
        : fetchText(suitePath).then(readSuiteCases),
      fetchText(`${CASE_LIST_DIR}/${agentId}.json`).then(
        (text): CaseListFile => CaseListFileSchema.parse(JSON.parse(text)),
      ),
    ])

    let suite: SuiteCases | undefined
    if (suiteResult.status === 'rejected') {
      this.logger.warn(
        {
          err:
            suiteResult.reason instanceof Error
              ? suiteResult.reason
              : new Error(String(suiteResult.reason)),
          agentId,
        },
        'Case scout could not read a judged suite',
      )
      errors.push(`suite ${agentId} could not be read`)
    } else if (suiteResult.value) {
      suite = suiteResult.value
      if (suite.cases.length === 0) {
        errors.push(`suite ${agentId} had no readable cases`)
      }
      if (suite.unreadConditions > 0) {
        errors.push(
          `${suite.unreadConditions} suite conditions in ${agentId} ` +
            'could not be read',
        )
      }
    }

    let list: CaseListFile | undefined
    if (listResult.status === 'rejected') {
      this.logger.warn(
        {
          err:
            listResult.reason instanceof Error
              ? listResult.reason
              : new Error(String(listResult.reason)),
          agentId,
        },
        'Case scout could not read a case list',
      )
      errors.push(`case list ${agentId}.json could not be read`)
    } else {
      list = listResult.value
    }

    const suiteCases = suite?.cases ?? []
    if (suiteCases.length === 0 && list === undefined) {
      throw new Error(`no case list for ${agentId} could be read`)
    }

    return mergeCaseLists(agentId, suiteCases, list)
  }

  // A GitHub hiccup costs tonight's drafts their view of the existing
  // conditions, not the drafts themselves, as in the Python reader. The run
  // record lists the miss.
  async readOrEmpty(agentId: string, errors: string[]): Promise<CaseListInfo> {
    try {
      return await this.read(agentId, errors)
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
