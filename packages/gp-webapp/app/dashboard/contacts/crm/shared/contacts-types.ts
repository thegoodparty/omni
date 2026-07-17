import type {
  Person,
  PeopleListResponse,
  ContactNote,
  ContactNoteInput,
  ContactNoteListResponse,
} from '@goodparty_org/contracts'

export interface SegmentResponse {
  id: number
  name?: string
  // Free-text search term persisted when a list is saved directly from a
  // contacts search result set (ENG-10518); absent for filter-only lists.
  search?: string | null
  [key: string]: unknown
}

export type { Person }

export type ListContactsResponse = PeopleListResponse

export type { ContactNote, ContactNoteInput, ContactNoteListResponse }

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

// Serve poll-interaction activity (elected office context). The literal
// matches gp-api's ConstituentActivityType.POLL_INTERACTIONS so this and
// OutreachConstituentActivity form a discriminated union on `type`.
export type PollConstituentActivity = {
  type: 'POLL_INTERACTIONS'
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
