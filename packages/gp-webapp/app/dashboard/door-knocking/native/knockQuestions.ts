import {
  DoorKnockOutcome,
  FollowUpAnswer,
  SupportAnswer,
  WillVoteAnswer,
} from '@goodparty_org/contracts'

// The questions a knock answers. The app walks them as a tree — only a door
// that answered is asked anything else — while paper prints the five outcomes
// flat, because a sheet cannot branch and has to offer every ending at once.
// Both surfaces read these constants: paper is transcribed back into this
// form, so a wording or ordering difference between the two turns into a
// mis-keyed answer.

// Every ending, and the label for an outcome anywhere it is named on its own.
// Paper's outcome row, and `walkFacts.ts`'s last-contact line. Each option in
// the app's two steps below resolves to one of these.
export const OUTCOME_OPTIONS: Array<[DoorKnockOutcome, string]> = [
  ['answered', 'Answered'],
  ['not_home', 'Not home'],
  ['inaccessible', 'Inaccessible'],
  ['refused_to_engage', 'Refused to engage'],
  ['not_a_voter', 'Not a voter'],
]

// The app's first question. Two of the three end the knock; `answered` is the
// only one with a follow-up.
export const ANSWER_OPTIONS: Array<[DoorKnockOutcome, string]> = [
  ['answered', 'Answered'],
  ['not_home', 'Not home'],
  ['inaccessible', 'Inaccessible'],
]

// The app's second question, asked only of a door that answered. `answered`
// carries a different label here than in the flat row above, because at this
// point in the walkthrough "Answered" is the question already behind the
// canvasser — what is being asked is whether the conversation happened.
export const ENGAGEMENT_OPTIONS: Array<[DoorKnockOutcome, string]> = [
  ['answered', 'Engaged'],
  ['refused_to_engage', 'Refused'],
  ['not_a_voter', 'Not voter'],
]

export const SUPPORT_OPTIONS: Array<[SupportAnswer, string]> = [
  ['supporter', 'Yes'],
  ['non_supporter', 'No'],
  ['unsure', 'Unsure'],
]

export const WILL_VOTE_OPTIONS: Array<[WillVoteAnswer, string]> = [
  ['yes', 'Yes'],
  ['no', 'No'],
  ['unsure', 'Unsure'],
]

// The Serve door's last question, and the whole of its engaged branch — where
// Win asks two. Binary where support and will-vote are three-way: "Unsure"
// there is a real answer about a resident who has not decided, but a canvasser
// standing at a door either owes them something afterwards or does not, and an
// Unsure would only be a way of not writing the note.
export const FOLLOW_UP_OPTIONS: Array<[FollowUpAnswer, string]> = [
  ['yes', 'Yes'],
  ['no', 'No'],
]

export const OUTCOME_QUESTION = 'Did they answer?'
export const ENGAGEMENT_QUESTION = 'Did they engage?'
export const SUPPORT_QUESTION = 'Do they support you?'
export const WILL_VOTE_QUESTION = 'Will they vote this election?'
export const FOLLOW_UP_QUESTION = 'Do they need follow-up?'
export const NOTE_QUESTION = 'Note'
