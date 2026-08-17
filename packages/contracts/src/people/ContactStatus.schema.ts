import { z } from 'zod'
import {
  ContactStatusFieldSchema as GeneratedContactStatusFieldSchema,
  type ContactStatusField as GeneratedContactStatusField,
  ContactStatusSourceSchema as GeneratedContactStatusSourceSchema,
  type ContactStatusSource as GeneratedContactStatusSource,
  DoNotKnockStatusSchema as GeneratedDoNotKnockStatusSchema,
  type DoNotKnockStatus as GeneratedDoNotKnockStatus,
  SupportStatusRollupSchema as GeneratedSupportStatusRollupSchema,
  type SupportStatusRollup as GeneratedSupportStatusRollup,
  VoterLikelihoodSchema as GeneratedVoterLikelihoodSchema,
  type VoterLikelihood as GeneratedVoterLikelihood,
} from '../generated/enums'

// The two editable per-contact statuses (ENG-10833). Opt In Status has no
// member here — it is not editable (TCPA product decision, 2026-07-28): a
// manual override on a texted STOP has no safe semantics. Sourced from the
// Prisma `VoterLikelihood`/`ContactStatusField`/`ContactStatusSource` enums
// via `../generated/enums`.
export const VoterLikelihoodSchema = GeneratedVoterLikelihoodSchema
export type VoterLikelihood = GeneratedVoterLikelihood

export const ContactStatusFieldSchema = GeneratedContactStatusFieldSchema
export type ContactStatusField = GeneratedContactStatusField

export const ContactStatusSourceSchema = GeneratedContactStatusSourceSchema
export type ContactStatusSource = GeneratedContactStatusSource

// ADR 0007. Not a member of UpdateContactStatusInputSchema below: the CRM's
// status PATCH is Pro-gated, and the flagged door-knocking pilot is not, so
// do-not-knock is written through its own door-knocking endpoint instead.
export const DoNotKnockStatusSchema = GeneratedDoNotKnockStatusSchema
export type DoNotKnockStatus = GeneratedDoNotKnockStatus

// Discriminated by `field` so each value validates against its own
// vocabulary at the API boundary — a `support_status` value can't ride in on
// a `voter_likelihood` write, and vice versa. `.strict()` on both branches so
// an extra key 400s instead of being silently dropped.
export const UpdateContactStatusInputSchema = z.discriminatedUnion('field', [
  z
    .object({
      field: z.literal('voter_likelihood'),
      value: VoterLikelihoodSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal('support_status'),
      value: GeneratedSupportStatusRollupSchema,
    })
    .strict(),
])

export type UpdateContactStatusInput = z.infer<
  typeof UpdateContactStatusInputSchema
>

// The effective (override ?? derived/seed) values for both editable
// statuses, returned by the status-update endpoint. Always both present for
// a Win org — the write path 400s before this response is built otherwise.
export const ContactStatusesSchema = z.object({
  voterLikelihood: VoterLikelihoodSchema,
  supportStatus: GeneratedSupportStatusRollupSchema,
})

export type ContactStatuses = z.infer<typeof ContactStatusesSchema>

// Display-label maps for the two editable fields (ENG-10835 activity feed).
// Centralized here — not in gp-webapp — so the feed's fromLabel/toLabel are
// resolved once, server-side, and every consumer (webapp today, any future
// one) renders the same text instead of maintaining its own copy of the
// vocabulary.
export const VOTER_LIKELIHOOD_LABELS: Record<VoterLikelihood, string> = {
  unknown: 'Unknown',
  unlikely: 'Unlikely',
  unreliable: 'Unreliable',
  likely: 'Likely',
  super: 'Super',
}

export const SUPPORT_STATUS_ROLLUP_LABELS: Record<
  GeneratedSupportStatusRollup,
  string
> = {
  supporter: 'Supporter',
  non_supporter: 'Non-supporter',
  unknown: 'Support unknown',
  undecided: 'Undecided',
  refused: 'Refused',
}

// ADR 0007. Read as "Do Not Knock: — -> On" in the feed, so the values carry
// the on/off reading and the field name carries the meaning.
export const DO_NOT_KNOCK_LABELS: Record<DoNotKnockStatus, string> = {
  active: 'On',
  cleared: 'Off',
}

// fromValue/toValue persist as a plain Prisma `String` on ContactStatusEvent
// (each field's vocabulary is only Zod-enforced at write time, via
// UpdateContactStatusInputSchema above) — a value outside today's map, from a
// future enum member or a not-yet-built write source, must render as itself
// rather than throw or go blank (mirrors the fallback convention
// ActivityFeedEntry.tsx already uses for DOOR_KNOCK outcome labels).
// Keyed by field rather than a ternary chain: the previous two-armed version
// routed any field it did not recognize to the support-status labels, so a new
// field's values silently rendered as raw strings. A Record fails to compile
// instead.
const LABELS_BY_FIELD: Record<ContactStatusField, Record<string, string>> = {
  voter_likelihood: VOTER_LIKELIHOOD_LABELS,
  support_status: SUPPORT_STATUS_ROLLUP_LABELS,
  do_not_knock: DO_NOT_KNOCK_LABELS,
}

export const resolveContactStatusLabel = (
  field: ContactStatusField,
  value: string,
): string => LABELS_BY_FIELD[field][value] ?? value
