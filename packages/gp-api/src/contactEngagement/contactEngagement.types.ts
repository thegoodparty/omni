import {
  OutreachType,
  VoterOutreachAttributionSource,
} from '../generated/prisma'

export enum ConstituentActivityType {
  POLL_INTERACTIONS = 'POLL_INTERACTIONS',
  OUTREACH = 'OUTREACH',
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

export type ConstituentActivity = {
  type: ConstituentActivityType
  date: string
  data: {
    pollId: string
    pollTitle: string
    events: ConstituentActivityEvent[]
  }
}

export type GetIndividualActivitiesResponse = {
  nextCursor: string | null
  results: ConstituentActivity[]
}

// Win campaign outreach, read from VoterOutreachActivity (keyed on the durable
// lalVoterId). attributionSource lets the timeline label send-time vs
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

export type GetCampaignActivitiesResponse = {
  nextCursor: string | null
  results: OutreachConstituentActivity[]
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
