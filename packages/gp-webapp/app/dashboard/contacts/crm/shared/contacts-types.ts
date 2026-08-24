import type {
  ContactNote,
  ContactNoteInput,
  ContactNoteListResponse,
  ContactStatuses,
  ConstituentActivity,
  ConstituentActivityEvent,
  ConstituentActivityEventType,
  ContactStatusField,
  DoorKnockConstituentActivity,
  GetIndividualActivitiesResponse,
  ListDetailContactsResponse,
  ListDetailOutreachHistoryEntry,
  ListDetailReachability,
  LogContactInteractionInput,
  LogContactInteractionResponse,
  OutreachConstituentActivity,
  OutreachType,
  PeopleListResponse,
  Person,
  PhoneBankingConstituentActivity,
  PollConstituentActivity,
  RobocallConstituentActivity,
  StatusChangeConstituentActivity,
  SupportStatusRollup,
  TextConstituentActivity,
  UpdateContactStatusInput,
  VoterLikelihood,
  VoterOutreachAttributionSource,
} from '@goodparty_org/contracts'
// Keeps the activity-condition shape defined once (ENG-10708); the sibling
// pulls its contract types from @goodparty_org/contracts directly so this
// import stays one-directional (madge circular check).
import type { ActivityConditionInput } from './activityConditionOptions'

export interface SegmentResponse {
  id: number
  name?: string
  // Free-text search term persisted when a list is saved directly from a
  // contacts search result set (ENG-10518); absent for filter-only lists.
  search?: string | null
  voterCount?: number
  // ENG-10703: activity/support criteria persisted on the saved list, and the
  // atomic first-use stamp that locks it from further edits (ENG-10707 reads
  // this to swap rename/delete for "duplicate to edit").
  activityConditions?: ActivityConditionInput[]
  supportStatus?: SupportStatusRollup[]
  firstUsedForOutreachAt?: string | null
  [key: string]: unknown
}

export type { Person, SupportStatusRollup }

// The two editable per-contact statuses (ENG-10833/ENG-10836): request/
// response shapes for PATCH /v1/contacts/:personId/status, defined once in
// @goodparty_org/contracts/people/ContactStatus.schema.
export type { ContactStatuses, UpdateContactStatusInput, VoterLikelihood }

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
  ContactStatusField,
  DoorKnockConstituentActivity,
  GetIndividualActivitiesResponse,
  OutreachConstituentActivity,
  PhoneBankingConstituentActivity,
  PollConstituentActivity,
  RobocallConstituentActivity,
  StatusChangeConstituentActivity,
  TextConstituentActivity,
}

// OutreachConstituentActivity's data fields, aliased to their historical
// local names (outreachType/attributionSource render labels key off these).
export type OutreachChannel = OutreachType
export type OutreachAttributionSource = VoterOutreachAttributionSource

// GET /v1/contacts/list-detail (ENG-10706): demographics + reachable-by-channel
// counts + outreach history for one saved list, consumed by the list-detail
// page (task 08). Defined once in
// @goodparty_org/contracts/people/ListDetailContacts.schema and re-exported
// here so this feature's imports don't all need to change.
export type {
  ListDetailContactsResponse,
  ListDetailOutreachHistoryEntry,
  ListDetailReachability,
}
