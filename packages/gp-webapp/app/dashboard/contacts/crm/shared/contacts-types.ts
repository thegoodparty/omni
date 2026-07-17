import type {
  ContactNote,
  ContactNoteInput,
  ContactNoteListResponse,
  ConstituentActivity,
  ConstituentActivityEvent,
  ConstituentActivityEventType,
  DoorKnockConstituentActivity,
  GetIndividualActivitiesResponse,
  LogContactInteractionInput,
  LogContactInteractionResponse,
  NoteConstituentActivity,
  OutreachConstituentActivity,
  OutreachStatus,
  OutreachType,
  PeopleListResponse,
  Person,
  PollConstituentActivity,
  RobocallConstituentActivity,
  SupportStatusRollup,
  TextConstituentActivity,
  VoterOutreachAttributionSource,
} from '@goodparty_org/contracts'

export interface SegmentResponse {
  id: number
  name?: string
  // Free-text search term persisted when a list is saved directly from a
  // contacts search result set (ENG-10518); absent for filter-only lists.
  search?: string | null
  [key: string]: unknown
}

export type { Person, SupportStatusRollup }

export type ListContactsResponse = PeopleListResponse

export type { ContactNote, ContactNoteInput, ContactNoteListResponse }

// Manual interaction logging (ENG-10694/ENG-10698): the request/response
// shapes for POST /v1/contacts/:personId/interactions, defined once in
// @goodparty_org/contracts/people/LogContactInteraction.schema.
export type { LogContactInteractionInput, LogContactInteractionResponse }

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

// The unified activity-feed shape (all variants, the discriminant enums, the
// response envelope) is the cross-service contract for
// GET /v1/contact-engagement/:id/activities, defined once in
// @goodparty_org/contracts/people/ContactActivity.schema and re-exported here
// so the many existing imports across this feature don't all need to change.
export type {
  ConstituentActivity,
  ConstituentActivityEvent,
  ConstituentActivityEventType,
  DoorKnockConstituentActivity,
  GetIndividualActivitiesResponse,
  NoteConstituentActivity,
  OutreachConstituentActivity,
  PollConstituentActivity,
  RobocallConstituentActivity,
  TextConstituentActivity,
}

// OutreachConstituentActivity's data fields, aliased to their historical
// local names (outreachType/attributionSource render labels key off these).
export type OutreachChannel = OutreachType
export type OutreachAttributionSource = VoterOutreachAttributionSource

// GET /v1/contacts/list-detail (ENG-10706): demographics + reachable-by-channel
// counts + outreach history for one saved list, consumed by the list-detail
// page (task 08). email/metaAds are always null — no eligibility data source
// exists for either channel, so the UI renders them as unavailable, never 0.
export type ListDetailReachability = {
  sms: number
  robocall: number
  phoneBanking: number
  doorKnocking: number
  email: null
  metaAds: null
}

export type ListDetailOutreachHistoryEntry = {
  id: number
  name: string | null
  outreachType: OutreachType
  status: OutreachStatus | null
  date: string | null
}

export type ListDetailContactsResponse = {
  demographics: {
    people: number
    avgAge: number | null
    avgIncome: number | null
  }
  reachability: ListDetailReachability
  outreachHistory: ListDetailOutreachHistoryEntry[]
}
