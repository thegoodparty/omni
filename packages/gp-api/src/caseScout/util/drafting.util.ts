import { crc32 } from 'node:zlib'
import { draftingSystemPrompt } from '../caseScout.prompts'
import {
  DraftResponseSchema,
  type DraftResponse,
} from '../schemas/caseScoutModel.schema'
import {
  MAX_CASE_ID_LENGTH,
  MAX_CASE_TURNS,
  MAX_CONDITION_CHARS,
  MAX_HANDLED_WHEN_CHARS,
  type DraftedCase,
} from '../schemas/draftedCase.schema'
import type { CaseScoutModelService } from '../services/caseScoutModel.service'
import { extractJsonObject } from './extractJson.util'
import type { LedgerEntry } from './ledger.util'
import type { Session } from './sessions.util'
import { renderSessionTranscript } from './transcript.util'

const DRAFT_PARSE_ATTEMPTS = 2

// About 2 tune to 1 holdout, from a hash of the caseId so the split needs no
// state across nights. The same crc32 Python's zlib computes.
export const assignSplit = (caseId: string): 'tune' | 'holdout' =>
  crc32(caseId) % 3 === 2 ? 'holdout' : 'tune'

export type DraftContext = {
  agentId: string
  fixtureDescription: string
  currentConditions: string[]
  recentProposals: LedgerEntry[]
}

export const buildDraftingPrompt = (context: DraftContext): string =>
  draftingSystemPrompt({
    agentId: context.agentId,
    fixtureDescription:
      context.fixtureDescription ||
      '(no fixture description available tonight)',
    currentConditions:
      context.currentConditions.length === 0
        ? '(none yet)'
        : context.currentConditions
            .map((condition) => `- ${condition}`)
            .join('\n'),
    recentProposals:
      context.recentProposals.length === 0
        ? '(none in the last 30 days)'
        : context.recentProposals
            .filter((proposal) => proposal.caseId)
            .map((p) => `- ${p.caseId}: ${p.failureSummary}`)
            .join('\n'),
    maxCaseId: MAX_CASE_ID_LENGTH,
    maxTurns: MAX_CASE_TURNS,
    maxCondition: MAX_CONDITION_CHARS,
    maxHandledWhen: MAX_HANDLED_WHEN_CHARS,
  })

// Throws on anything malformed; the caller retries the call once on a throw.
export const parseDraftResponse = (text: string): DraftResponse =>
  DraftResponseSchema.parse(extractJsonObject(text))

export class DraftingError extends Error {}

export type Drafter = Pick<CaseScoutModelService, 'draftCase'>

// One drafting call, retried once when the reply cannot be read. A failed
// call is not retried, as in the Python reader. The draft job, the quality
// bench and the de-identifier eval all draft through here.
export const draftCandidate = async (
  drafter: Drafter,
  session: Session,
  system: string,
  signal: AbortSignal,
): Promise<DraftResponse> => {
  const transcript = renderSessionTranscript(session)
  let lastError = 'unknown'
  for (let attempt = 0; attempt < DRAFT_PARSE_ATTEMPTS; attempt++) {
    let text: string
    try {
      text = await drafter.draftCase(session.scope, system, transcript, signal)
    } catch (err) {
      if (signal.aborted) throw err
      throw new DraftingError(
        `session ${session.sessionId}: drafting call failed`,
      )
    }
    try {
      return parseDraftResponse(text)
    } catch (err) {
      lastError = err instanceof Error ? err.message : lastError
    }
  }
  throw new DraftingError(
    `session ${session.sessionId}: drafting response could not be parsed ` +
      `after retry (${lastError})`,
  )
}

export type NewCaseResponse = Extract<DraftResponse, { outcome: 'newCase' }>

export const buildDraftedCase = (
  drafted: NewCaseResponse['case'],
): DraftedCase => ({
  caseId: drafted.caseId,
  condition: drafted.condition,
  handledWhen: drafted.handledWhen,
  source: 'production',
  split: assignSplit(drafted.caseId),
  ...(drafted.question !== undefined
    ? { question: drafted.question }
    : { turns: drafted.turns }),
})
