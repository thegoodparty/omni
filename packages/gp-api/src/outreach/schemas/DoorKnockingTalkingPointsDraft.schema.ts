import { z } from 'zod'
import {
  DOOR_KNOCKING_INSTRUCTIONS_MAX_LENGTH,
  DOOR_KNOCKING_TALKING_POINTS_MAX_LENGTH,
  DoorKnockingTalkingPointsPurposeSchema,
  ServeDoorKnockingTalkingPointsPurposeSchema,
} from '@goodparty_org/contracts'
import { voterFilterBaseSchema } from '@/shared/schemas/voterFilterBase.schema'

// The draft request for door-knocking talking points.
//
// Here rather than in contracts because it carries `voterFilterBaseSchema`,
// which lives in gp-api — the same split `CountContactsDTO` makes for the same
// reason. Contracts holds the purposes, the length budgets, and the response.
//
// No `tone`. The output is notes a canvasser puts in their own words, not
// prose with a voice to select — see the header of the contracts file.

// The audience, inline rather than by id.
//
// Door knocking files its VoterFileFilter row inside the create mutation, not
// before it (`CreateListFlow`'s `createdFilterIdRef`, whose cleanup deletes
// what it holds), so at the moment this endpoint is called a hand-cut audience
// has no id yet. The wizard's `filters` state is populated either way — a
// saved list lifts its own filters into the draft when picked — so sending the
// clauses is the one form that works from every entry point, and it spares
// this endpoint a row read besides.
//
// Named `filters`, plural, to match `POST /v1/door-knocking/address-preview` —
// the sibling endpoint that takes this same unsaved-draft grammar from the
// same wizard — and the `filters` state the wizard sends from.
const draftRequestShape = {
  filters: voterFilterBaseSchema,
  // currentDraft switches the endpoint from writing fresh points to polishing
  // the given text. previousDraft is distinct: it rides along on a FRESH
  // generation (Regenerate) to tell the model what the candidate just
  // rejected, so the re-roll varies instead of converging. Same arrangement
  // phone banking settled on, and the same mutual exclusion below.
  currentDraft: z
    .string()
    .min(1)
    .max(DOOR_KNOCKING_TALKING_POINTS_MAX_LENGTH)
    .optional(),
  previousDraft: z
    .string()
    .max(DOOR_KNOCKING_TALKING_POINTS_MAX_LENGTH)
    .optional(),
  // Whitespace-only is treated as absent rather than a violation — a
  // trim-then-min(1) without this transform 400s on '   ' even though the
  // field is optional, and the client cannot tell "blank" from a real schema
  // error.
  instructions: z
    .string()
    .trim()
    .max(DOOR_KNOCKING_INSTRUCTIONS_MAX_LENGTH)
    .transform((v) => (v.length === 0 ? undefined : v))
    .optional(),
} as const

const bothDraftsRefinement = {
  message: 'currentDraft and previousDraft are mutually exclusive',
  path: ['previousDraft'],
}

const exclusive = (v: { currentDraft?: string; previousDraft?: string }) =>
  v.currentDraft === undefined || v.previousDraft === undefined

export const DoorKnockingTalkingPointsDraftRequestSchema = z
  .object({
    purpose: DoorKnockingTalkingPointsPurposeSchema,
    ...draftRequestShape,
  })
  // The two paths are mutually exclusive by construction (the service picks
  // improve vs. fresh generation off currentDraft alone, so a previousDraft
  // beside it would be silently dropped) — reject the combination rather than
  // accepting and ignoring it.
  .refine(exclusive, bothDraftsRefinement)

export type DoorKnockingTalkingPointsDraftRequest = z.infer<
  typeof DoorKnockingTalkingPointsDraftRequestSchema
>

// Serve's counterpart — identical but for the purpose vocabulary.
export const ServeDoorKnockingTalkingPointsDraftRequestSchema = z
  .object({
    purpose: ServeDoorKnockingTalkingPointsPurposeSchema,
    ...draftRequestShape,
  })
  .refine(exclusive, bothDraftsRefinement)

export type ServeDoorKnockingTalkingPointsDraftRequest = z.infer<
  typeof ServeDoorKnockingTalkingPointsDraftRequestSchema
>
