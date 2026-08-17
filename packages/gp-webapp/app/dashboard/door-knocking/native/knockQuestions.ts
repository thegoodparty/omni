import {
  DoorKnockOutcome,
  SupportAnswer,
  WillVoteAnswer,
} from '@goodparty_org/contracts'

// The three questions a knock answers, in the order they're asked. Shared by
// the in-app form and the printed walk sheet: paper is transcribed back into
// that form afterwards, so a wording or ordering difference between the two
// turns into a mis-keyed answer.
export const OUTCOME_OPTIONS: Array<[DoorKnockOutcome, string]> = [
  ['answered', 'Answered'],
  ['not_home', 'Not home'],
  ['inaccessible', 'Inaccessible'],
  ['refused_to_engage', 'Refused to engage'],
  ['not_a_voter', 'Not a voter'],
]

export const SUPPORT_OPTIONS: Array<[SupportAnswer, string]> = [
  ['supporter', 'Yes'],
  ['unsure', 'Unsure'],
  ['non_supporter', 'No'],
]

export const WILL_VOTE_OPTIONS: Array<[WillVoteAnswer, string]> = [
  ['yes', 'Yes'],
  ['unsure', 'Unsure'],
  ['no', 'No'],
]

export const OUTCOME_QUESTION = 'Did they answer?'
export const SUPPORT_QUESTION = 'Do they support you?'
export const WILL_VOTE_QUESTION = 'Will they vote?'

// The brief's two-tap path: one flat row where every chip is a COMPLETE
// result, so the common door costs one tap to open and one to log. Walking
// the cascade above instead costs three taps at best, and the brief is blunt
// about why that matters — "keeping records is not a second job I will
// quietly stop doing".
//
// Flattened onto the existing contract, not new enum members: the brief's
// list ("supporter, lean, undecided, not home, refused, moved, sign request")
// maps onto DoorKnockOutcome x SupportAnswer, with `lean` collapsing into
// Undecided and `sign request` having no field to land in — it stays a note.
export interface QuickResult {
  id: string
  label: string
  outcome: DoorKnockOutcome
  supportAnswer?: SupportAnswer
}

// Ordered by how often a canvasser reaches for each one, not by the brief's
// prose order: most doors go unanswered, so "Not home" sits under the thumb.
export const QUICK_RESULTS: QuickResult[] = [
  { id: 'not_home', label: 'Not home', outcome: 'not_home' },
  {
    id: 'supporter',
    label: 'Supporter',
    outcome: 'answered',
    supportAnswer: 'supporter',
  },
  {
    id: 'undecided',
    label: 'Undecided',
    outcome: 'answered',
    supportAnswer: 'unsure',
  },
  {
    id: 'non_supporter',
    label: 'Not supporting',
    outcome: 'answered',
    supportAnswer: 'non_supporter',
  },
  { id: 'refused', label: 'Refused', outcome: 'refused_to_engage' },
  { id: 'not_a_voter', label: 'Not a voter', outcome: 'not_a_voter' },
  { id: 'inaccessible', label: 'Inaccessible', outcome: 'inaccessible' },
]

export const QUICK_QUESTION = 'What happened?'
