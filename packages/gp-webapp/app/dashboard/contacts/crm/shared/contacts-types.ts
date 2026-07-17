import type { Person, PeopleListResponse } from '@goodparty_org/contracts'

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

export type DoorKnockOutcome = 'answered' | 'not_home' | 'refused_to_engage'
export type SupportAnswer = 'supporter' | 'unsure' | 'non_supporter'

// ContactInteraction*/ContactNote entry types (ENG-10695). Rendering these is
// task 07's job — for now they only need to round-trip through the feed
// without crashing the pre-CRM PersonOverlay renderer.
export type DoorKnockConstituentActivity = {
  type: 'DOOR_KNOCK'
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
  type: 'TEXT'
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
  type: 'ROBOCALL'
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
  type: 'NOTE'
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
