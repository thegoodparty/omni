import type { Person, PeopleListResponse } from '@goodparty_org/contracts'

export interface SegmentResponse {
  id: number
  name?: string
  [key: string]: unknown
}

export type { Person }

export type ListContactsResponse = PeopleListResponse

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

export type ConstituentActivityEventType = 'SENT' | 'RESPONDED' | 'OPTED_OUT'

export type ConstituentActivityEvent = {
  type: ConstituentActivityEventType
  date: string
}

// Serve poll-interaction activity (elected office context).
export type PollConstituentActivity = {
  type: string
  date: string
  data: {
    pollId: string
    pollTitle: string
    events: ConstituentActivityEvent[]
  }
}

// Win outreach activity, mapped from VoterOutreachActivity by gp-api's campaign
// branch. attributionSource lets the timeline label send-time vs per-recipient
// attribution honestly (recipient for door knocking, segmentDerived otherwise).
export type OutreachChannel =
  | 'text'
  | 'doorKnocking'
  | 'phoneBanking'
  | 'socialMedia'
  | 'robocall'
  | 'p2p'

export type OutreachAttributionSource = 'recipient' | 'segmentDerived'

export type OutreachConstituentActivity = {
  type: 'OUTREACH'
  date: string
  data: {
    activityId: number
    outreachType: OutreachChannel
    attributionSource: OutreachAttributionSource
  }
}

export type ConstituentActivity =
  | PollConstituentActivity
  | OutreachConstituentActivity

export type GetIndividualActivitiesResponse = {
  nextCursor: string | null
  results: ConstituentActivity[]
}
