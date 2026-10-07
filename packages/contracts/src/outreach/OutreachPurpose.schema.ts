import { z } from 'zod'

// The one purpose vocabulary shared across every outreach channel (SMS,
// robocall, phone banking, and door knocking per the recommended-lists
// feature) — consolidated from three divergent per-channel vocabularies so
// nothing reading across channels needs a translation table. Values are
// already valid Postgres identifiers, so a channel with its own storage
// enum (phone banking) needs no kebab/snake mapping layer either.
export const OUTREACH_PURPOSE_VALUES = [
  'introduce_myself',
  'persuade_voters',
  'event_invite',
  'early_voting',
  'election_day_turnout',
  // "Hear from voters": the one Win purpose that asks a question instead of
  // delivering a message. The same slug as Serve's community input, so issue
  // capture reads an effort's question the same way on both products.
  'community_input',
  'custom',
] as const
export const OutreachPurposeSchema = z.enum(OUTREACH_PURPOSE_VALUES)
export type OutreachPurpose = z.infer<typeof OutreachPurposeSchema>

// The Win list without `community_input`, for the channels that send to a
// list rather than hold a conversation: SMS, robocall and social. A question
// needs someone there to hear the answer and write it down, and these have
// nobody. Refused here rather than hidden in each picker, so their draft
// endpoints never write a script for a purpose they cannot serve.
export const BROADCAST_OUTREACH_PURPOSE_VALUES = [
  'introduce_myself',
  'persuade_voters',
  'event_invite',
  'early_voting',
  'election_day_turnout',
  'custom',
] as const satisfies readonly OutreachPurpose[]

// Serve's counterpart to the Win list above, shared the same way across
// every Serve outreach channel (phone banking, door knocking). Shared slugs
// (introduce_myself, event_invite, community_input, custom) deliberately
// reuse the Win strings — rows are disambiguated by scoping (campaignId vs
// organizationSlug), not by slug, same rule as serve social. Serve carries
// no election mechanics, so it does not adopt early_voting /
// election_day_turnout.
export const SERVE_OUTREACH_PURPOSE_VALUES = [
  'introduce_myself',
  'explain_decision',
  'event_invite',
  'community_input',
  'share_resource',
  'custom',
] as const
export const ServeOutreachPurposeSchema = z.enum(SERVE_OUTREACH_PURPOSE_VALUES)
export type ServeOutreachPurpose = z.infer<typeof ServeOutreachPurposeSchema>

// The one purpose that asks a question rather than delivering a message, and
// therefore the only one that has to record what the question IS. Lives here
// rather than in either channel's schema because door knocking and phone
// banking both branch on it, on both products, and a second copy is how they
// would drift.
export const COMMUNITY_INPUT_PURPOSE = 'community_input'

// A question a canvasser reads aloud at a door, so a sentence or two rather
// than a paragraph. Also the extraction prompt's context, where a long
// rambling question buries the note it is supposed to frame.
export const COMMUNITY_INPUT_QUESTION_MAX_LENGTH = 300
