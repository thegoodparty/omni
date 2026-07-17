import {
  DoorKnockOutcome,
  OutreachType,
  SupportAnswer,
  VoterOutreachAttributionSource,
} from '../generated/prisma'

export enum ConstituentActivityType {
  POLL_INTERACTIONS = 'POLL_INTERACTIONS',
  OUTREACH = 'OUTREACH',
  DOOR_KNOCK = 'DOOR_KNOCK',
  TEXT = 'TEXT',
  ROBOCALL = 'ROBOCALL',
  NOTE = 'NOTE',
}

export enum ConstituentActivityEventType {
  SENT = 'SENT',
  RESPONDED = 'RESPONDED',
  OPTED_OUT = 'OPTED_OUT',
}

export type ConstituentActivityEvent = {
  type: ConstituentActivityEventType
  date: string
}

// Serve poll-interaction activity (elected office context).
export type PollConstituentActivity = {
  type: ConstituentActivityType.POLL_INTERACTIONS
  date: string
  data: {
    pollId: string
    pollTitle: string
    events: ConstituentActivityEvent[]
  }
}

// Win campaign outreach, read from VoterOutreachActivity (keyed on the durable
// lalVoterId). Only appears when the request supplies `lalVoterId` — the
// endpoint's sunset-compatibility path for the pre-ContactInteraction Win
// timeline. attributionSource lets the timeline label send-time vs
// per-recipient attribution honestly.
export type OutreachConstituentActivity = {
  type: ConstituentActivityType.OUTREACH
  date: string
  data: {
    activityId: number
    outreachType: OutreachType
    attributionSource: VoterOutreachAttributionSource
  }
}

export type DoorKnockConstituentActivity = {
  type: ConstituentActivityType.DOOR_KNOCK
  date: string
  data: {
    activityId: string
    outcome: DoorKnockOutcome
    supportAnswer: SupportAnswer | null
    note: string | null
    manual: boolean
  }
}

export type TextConstituentActivity = {
  type: ConstituentActivityType.TEXT
  date: string
  data: {
    activityId: string
    respondedAt: string | null
    optedOutAt: string | null
    note: string | null
    manual: boolean
    outreachId: number | null
  }
}

export type RobocallConstituentActivity = {
  type: ConstituentActivityType.ROBOCALL
  date: string
  data: {
    activityId: string
    answeredAt: string | null
    voicemailLeftAt: string | null
    note: string | null
    manual: boolean
    outreachId: number | null
  }
}

export type NoteConstituentActivity = {
  type: ConstituentActivityType.NOTE
  date: string
  data: {
    noteId: string
    body: string
    createdAt: string
    updatedAt: string
  }
}

export type ConstituentActivity =
  | PollConstituentActivity
  | OutreachConstituentActivity
  | DoorKnockConstituentActivity
  | TextConstituentActivity
  | RobocallConstituentActivity
  | NoteConstituentActivity

export type GetIndividualActivitiesResponse = {
  nextCursor: string | null
  results: ConstituentActivity[]
}

export type ConstituentIssue = {
  issueTitle: string
  issueSummary: string
  pollTitle: string
  pollId: string
  date: string
}

export type GetConstituentIssuesResponse = {
  nextCursor: string | null
  results: ConstituentIssue[]
}
