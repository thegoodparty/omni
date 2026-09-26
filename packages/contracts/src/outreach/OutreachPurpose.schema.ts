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
  'custom',
] as const
export const OutreachPurposeSchema = z.enum(OUTREACH_PURPOSE_VALUES)
export type OutreachPurpose = z.infer<typeof OutreachPurposeSchema>

// Serve's counterpart to the Win list above, shared the same way across
// every Serve outreach channel (phone banking, door knocking). Shared slugs
// (introduce_myself, event_invite, custom) deliberately reuse the Win
// strings — rows are disambiguated by scoping (campaignId vs
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
// banking both branch on it and a second copy is how they would drift.
export const COMMUNITY_INPUT_PURPOSE = 'community_input'

// A question a canvasser reads aloud at a door, so a sentence or two rather
// than a paragraph. Also the extraction prompt's context, where a long
// rambling question buries the note it is supposed to frame.
export const COMMUNITY_INPUT_QUESTION_MAX_LENGTH = 300
