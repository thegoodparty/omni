import { z } from 'zod'
import {
  ContactStatusFieldSchema as GeneratedContactStatusFieldSchema,
  type ContactStatusField as GeneratedContactStatusField,
  ContactStatusSourceSchema as GeneratedContactStatusSourceSchema,
  type ContactStatusSource as GeneratedContactStatusSource,
  SupportStatusRollupSchema as GeneratedSupportStatusRollupSchema,
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
