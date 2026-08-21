import type {
  PhoneBankCallOutcome,
  PhoneBankingCallResult,
  PhoneBankingInteraction,
  PhoneBankingList,
  PhoneBankingListEntry,
  PhoneBankingListPerson,
  RecordPhoneBankingCall,
  SupportAnswer,
  WillVoteAnswer,
} from '@goodparty_org/contracts'

// The five outcomes are peers in the CONTRACT, but the form renders the
// canvas's answered -> "Did they engage?" split on top of them: Engaged
// continues to the support/will-vote cascade (saves `answered`), Refused is
// "answered but refused to engage" (saves `refused` attributed to the
// active person). The top-level Refused pill stays the number-level
// refused-without-identifying that fans out to the household.
export const OUTCOME_ORDER: PhoneBankCallOutcome[] = [
  'answered',
  'no_answer',
  'voicemail',
  'wrong_number',
  'refused',
]

export const OUTCOME_LABEL: Record<PhoneBankCallOutcome, string> = {
  answered: 'Answered',
  no_answer: 'No answer',
  voicemail: 'Voicemail left',
  wrong_number: 'Wrong number',
  refused: 'Refused',
}

// Design tokens only (no raw hex / Tailwind default palette).
export const OUTCOME_DOT_CLASS: Record<PhoneBankCallOutcome, string> = {
  answered: 'bg-success',
  no_answer: 'bg-muted-foreground',
  voicemail: 'bg-info',
  wrong_number: 'bg-destructive',
  refused: 'bg-warning',
}

export const SUPPORT_ANSWER_LABEL: Record<SupportAnswer, string> = {
  supporter: 'Yes',
  unsure: 'Unsure',
  non_supporter: 'No',
}

export const WILL_VOTE_ANSWER_LABEL: Record<WillVoteAnswer, string> = {
  yes: 'Yes',
  no: 'No',
  unsure: 'Unsure',
}

export const NOT_CALLED_LABEL = 'Not called'

export const allPersons = (
  list: Pick<PhoneBankingList, 'entries'>,
): PhoneBankingListPerson[] => list.entries.flatMap((entry) => entry.persons)

// Progress counts PEOPLE, per the ticket's canvas reference ("92 of 480
// reached"), never entries.
export const totalPeopleCount = (
  list: Pick<PhoneBankingList, 'entries'>,
): number => allPersons(list).length

export const calledPeopleCount = (
  list: Pick<PhoneBankingList, 'entries'>,
): number => allPersons(list).filter((person) => person.interaction).length

export const outcomeCounts = (
  list: Pick<PhoneBankingList, 'entries'>,
): Record<PhoneBankCallOutcome, number> => {
  const counts = OUTCOME_ORDER.reduce(
    (acc, outcome) => ({ ...acc, [outcome]: 0 }),
    {} as Record<PhoneBankCallOutcome, number>,
  )
  for (const person of allPersons(list)) {
    const outcome = person.interaction?.outcome
    if (outcome) counts[outcome] += 1
  }
  return counts
}

// A person with no live enrichment left has every live leaf null together
// (gp-api's toResponse defaults the whole `live` lookup to null as one
// unit) — checking one of them stands in for all of them, but every leaf is
// named here so the predicate can't silently drift if a leaf is added.
export const hasNoLiveEnrichment = (person: PhoneBankingListPerson): boolean =>
  person.age === null &&
  person.party === null &&
  person.address === null &&
  person.cellPhone === null &&
  person.landline === null

// The backend fans a number-level outcome out to every person on the entry
// (phoneBankingCall.service.ts's `applyOutcome`), so any one person carrying
// `wrong_number` means the whole entry does.
export const isEntrySuppressed = (entry: PhoneBankingListEntry): boolean =>
  entry.persons.some((person) => person.interaction?.outcome === 'wrong_number')

export const engagementStatusFor = (
  outcome: PhoneBankCallOutcome,
): 'engaged' | 'refused' | undefined => {
  if (outcome === 'answered') return 'engaged'
  if (outcome === 'refused') return 'refused'
  return undefined
}

// The outcome-cascade draft the entry panel's form holds before Save. Kept
// as a plain object + pure setters (rather than component state mutated
// inline) so the cascade rule — changing the outcome clears everything
// downstream — is one function, testable without rendering anything.
// `engagement` is UI-only state; it never persists (the review dropped the
// `engaged` column) — it selects which outcome the Save writes.
export type PhoneBankingEngagement = 'engaged' | 'refused'

export interface PhoneBankingOutcomeDraft {
  outcome?: PhoneBankCallOutcome
  engagement?: PhoneBankingEngagement
  supportAnswer?: SupportAnswer
  willVote?: WillVoteAnswer
}

export const EMPTY_DRAFT: PhoneBankingOutcomeDraft = {}

// Re-picking the outcome already selected is a no-op rather than a clear —
// otherwise clicking the active pill again would silently wipe a support/
// will-vote answer already chosen under it.
export const draftWithOutcome = (
  draft: PhoneBankingOutcomeDraft,
  outcome: PhoneBankCallOutcome | undefined,
): PhoneBankingOutcomeDraft =>
  outcome === draft.outcome
    ? draft
    : {
        outcome,
        engagement: undefined,
        supportAnswer: undefined,
        willVote: undefined,
      }

export const draftWithEngagement = (
  draft: PhoneBankingOutcomeDraft,
  engagement: PhoneBankingEngagement | undefined,
): PhoneBankingOutcomeDraft =>
  engagement === draft.engagement
    ? draft
    : {
        ...draft,
        engagement,
        supportAnswer: undefined,
        willVote: undefined,
      }

export const draftWithSupportAnswer = (
  draft: PhoneBankingOutcomeDraft,
  supportAnswer: SupportAnswer | undefined,
): PhoneBankingOutcomeDraft => ({ ...draft, supportAnswer })

export const draftWithWillVote = (
  draft: PhoneBankingOutcomeDraft,
  willVote: WillVoteAnswer | undefined,
): PhoneBankingOutcomeDraft => ({ ...draft, willVote })

// Reading a persisted row back into the cascade: an answered row that
// carries conversation answers must have come through the engaged path; a
// bare answered row (a markHouseholdDone fill) leaves engagement unpicked
// so an edit re-asks the question. A `refused` row can't distinguish
// person-level from fan-out on read, so it reopens as the top-level
// Refused pill — the persisted semantics are identical either way.
export const draftFromInteraction = (
  interaction: PhoneBankingInteraction | null,
): PhoneBankingOutcomeDraft =>
  interaction
    ? {
        outcome: interaction.outcome,
        engagement:
          interaction.outcome === 'answered' &&
          (interaction.supportAnswer || interaction.willVote)
            ? 'engaged'
            : undefined,
        supportAnswer: interaction.supportAnswer ?? undefined,
        willVote: interaction.willVote ?? undefined,
      }
    : EMPTY_DRAFT

// The design renders Save/Cancel only once the cascade reaches a terminal
// state: immediately for a number-level outcome, after engage = Refused, or
// after every question on the engaged path.
export const isDraftComplete = (draft: PhoneBankingOutcomeDraft): boolean => {
  if (!draft.outcome) return false
  if (draft.outcome !== 'answered') return true
  if (draft.engagement === 'refused') return true
  return (
    draft.engagement === 'engaged' &&
    draft.supportAnswer !== undefined &&
    draft.willVote !== undefined
  )
}

// Builds the exact POST body for one Save. `markHouseholdDone` only ever
// carries `true` (the schema's refine rejects it alongside a non-answered
// outcome), so a false/absent toggle is omitted rather than sent as false.
export const buildRecordCallRequest = (
  entryId: number,
  draft: PhoneBankingOutcomeDraft,
  activePersonId: string,
  markHouseholdDone: boolean,
): RecordPhoneBankingCall => {
  if (!draft.outcome) {
    throw new Error('An outcome must be selected before saving')
  }
  if (draft.outcome !== 'answered') {
    return { entryId, outcome: draft.outcome }
  }
  if (draft.engagement === 'refused') {
    return { entryId, outcome: 'refused', personId: activePersonId }
  }
  return {
    entryId,
    outcome: 'answered',
    personId: activePersonId,
    supportAnswer: draft.supportAnswer,
    willVote: draft.willVote,
    ...(markHouseholdDone ? { markHouseholdDone: true } : {}),
  }
}

// The POST response reads from the persisted rows (never the request), so
// every affected person — the whole entry for a number-level outcome, or
// the answered person plus any household members markHouseholdDone filled
// — can be patched into the cached list with no refetch.
export const applyCallResults = (
  list: PhoneBankingList,
  results: PhoneBankingCallResult[],
): PhoneBankingList => {
  if (results.length === 0) return list
  const interactionByPersonId = new Map<string, PhoneBankingInteraction>(
    results.map((result) => [result.personId, result.interaction]),
  )
  return {
    ...list,
    entries: list.entries.map((entry) => ({
      ...entry,
      persons: entry.persons.map((person) => {
        const interaction = interactionByPersonId.get(person.personId)
        return interaction ? { ...person, interaction } : person
      }),
    })),
  }
}
