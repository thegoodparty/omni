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
