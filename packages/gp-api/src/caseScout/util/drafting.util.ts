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
} from '../schemas/draftedCase.schema'
import { extractJsonObject } from './extractJson.util'
import type { LedgerEntry } from './ledger.util'

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
