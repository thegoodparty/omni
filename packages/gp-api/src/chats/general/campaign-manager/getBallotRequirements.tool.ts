import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type { ElectionsService } from '@/elections/services/elections.service'

// Strict so "takes no input" stays true in code: the race is bound server-side
// from the campaign's BallotReady race hash, so a smuggled hash can't redirect
// the lookup at another race.
const getBallotRequirementsInputSchema = z.object({}).strict()

export interface GetBallotRequirementsOutput {
  filingFee: number | null
  filingRequirementsText: string | null
  filingOfficeAddress: string | null
  filingPhoneNumber: string | null
  paperworkInstructions: string | null
  // The race's filing window as the campaign record stores it, so a deadline
  // answer comes from the record and not from memory. Null when the record
  // has no window. Not part of noDataFound: it is the record's answer, not
  // BallotReady's.
  filingPeriodStart: string | null
  filingPeriodEnd: string | null
  // True when BallotReady returned nothing usable for this race, so the model
  // reports the gap and falls back to web search instead of implying it looked
  // the requirements up and found none.
  noDataFound: boolean
}

const EMPTY = {
  filingFee: null,
  filingRequirementsText: null,
  filingOfficeAddress: null,
  filingPhoneNumber: null,
  paperworkInstructions: null,
  noDataFound: true,
}

// BallotReady's filing requirements for the candidate's own race, via
// election-api's by-br-hash-id/filing-fee lookup (the same source the
// Pro-upgrade filing-instructions screen uses). This is authoritative,
// race-specific data, so the prompt tells the manager to call it before
// reaching for web search on any ballot-access question. The race hash is bound
// from the resolved chat context; the service already swallows upstream
// failures and returns null, which surfaces here as noDataFound.
export const buildGetBallotRequirementsTool = (deps: {
  elections: Pick<ElectionsService, 'fetchFilingFeeByRaceHash'>
  raceId: string
  // The filing window from the resolved context, bound the way the race is.
  filingPeriodStart: string | null
  filingPeriodEnd: string | null
}): LlmStreamTool<typeof getBallotRequirementsInputSchema> => ({
  description:
    "Look up BallotReady's filing requirements for this candidate's race: " +
    'the filing fee, the raw filing-requirements text, and the filing ' +
    "office's address, phone number, and paperwork instructions, plus the " +
    'filing window as the campaign record stores it (filingPeriodStart and ' +
    'filingPeriodEnd). Takes no input; the race is bound server-side. Call ' +
    'this FIRST on any question about getting on the ballot, filing, or ' +
    'petitions, before any web search. Fields are null where BallotReady ' +
    'has no data, and noDataFound is true when it has none at all — say so ' +
    'and fall back to web search rather than implying the requirements do ' +
    'not exist. The filing window is a snapshot from when the candidate set ' +
    'up the race, so name the filing office as the place to confirm a ' +
    'deadline before the candidate relies on it. The fee is an estimate ' +
    'parsed from the requirements text, so quote the text as the source of ' +
    'truth when both are present.',
  inputSchema: getBallotRequirementsInputSchema,
  execute: async (): Promise<GetBallotRequirementsOutput> => {
    const window = {
      filingPeriodStart: deps.filingPeriodStart,
      filingPeriodEnd: deps.filingPeriodEnd,
    }
    const result = await deps.elections.fetchFilingFeeByRaceHash(deps.raceId)
    if (!result) return { ...EMPTY, ...window }
    const {
      filingFee,
      filingRequirementsText,
      filingOfficeAddress,
      filingPhoneNumber,
      paperworkInstructions,
    } = result
    return {
      filingFee,
      filingRequirementsText,
      filingOfficeAddress,
      filingPhoneNumber,
      paperworkInstructions,
      ...window,
      noDataFound:
        filingFee === null &&
        !filingRequirementsText &&
        !filingOfficeAddress &&
        !filingPhoneNumber &&
        !paperworkInstructions,
    }
  },
})
