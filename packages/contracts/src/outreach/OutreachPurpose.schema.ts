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
