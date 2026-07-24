import {
  ConstituentActivityEventTypeSchema,
  ConstituentActivityTypeSchema,
} from '@goodparty_org/contracts'
import type {
  ConstituentActivity,
  ConstituentActivityEvent,
  DoorKnockConstituentActivity,
  GetIndividualActivitiesResponse,
  OutreachConstituentActivity,
  PollConstituentActivity,
  RobocallConstituentActivity,
  TextConstituentActivity,
} from '@goodparty_org/contracts'

// The unified activity-feed shape (all variants, the discriminant enums, and
// the response envelope) is the cross-service contract for
// GET /v1/contact-engagement/:id/activities — defined once in
// @goodparty_org/contracts/people/ContactActivity.schema and re-exported here
// so this feature's existing imports don't all need to change. `.enum` gives
// the same dot-access ergonomics a local TS enum would, but as plain string
// literals — structurally compatible with the contracts-derived union (a
// real TS `enum` member is a distinct nominal type, not assignable to it).
export const ConstituentActivityType = ConstituentActivityTypeSchema.enum
export const ConstituentActivityEventType =
  ConstituentActivityEventTypeSchema.enum

export type {
  ConstituentActivity,
  ConstituentActivityEvent,
  DoorKnockConstituentActivity,
  GetIndividualActivitiesResponse,
  OutreachConstituentActivity,
  PollConstituentActivity,
  RobocallConstituentActivity,
  TextConstituentActivity,
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
