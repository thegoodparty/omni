import { z } from 'zod'
import {
  OutreachPurposeSchema,
  ServeOutreachPurposeSchema,
} from './OutreachPurpose.schema'

// Talking points for a door-knocking list: what the canvasser says, written
// once for the whole list rather than per person at the door.
//
// Modelled on PhoneBankingScript.schema.ts, with three deliberate differences.
//
// No `tone`. Phone banking's output is a word-for-word script and a tone
// selector changes its voice; these are notes a canvasser glances at and puts
// in their own words, so there is no prose voice to select.
//
// The response is three named fields rather than one `draft` string. The card
// has five sections (see docs/features/door-knocking-talking-points.md, from
// product's Door Knocking Script template) and the model writes only three of
// them — naming each means it cannot merge or reorder them, and each is
// separately assertable in a test.
//
// The REQUEST is not here. It carries the audience as an inline voter filter,
// and that shape is `voterFilterBaseSchema` in gp-api, which contracts cannot
// import — so the DTO is composed there, next to the schema it extends, the
// same way `CountContactsDTO` is. Everything the webapp needs to build one is
// here or in the generated route types.

export const DoorKnockingTalkingPointsPurposeSchema = OutreachPurposeSchema
export type DoorKnockingTalkingPointsPurpose = z.infer<
  typeof DoorKnockingTalkingPointsPurposeSchema
>

export const ServeDoorKnockingTalkingPointsPurposeSchema =
  ServeOutreachPurposeSchema
export type ServeDoorKnockingTalkingPointsPurpose = z.infer<
  typeof ServeDoorKnockingTalkingPointsPurposeSchema
>

// One line each, not a paragraph. Generous enough that a candidate's own edit
// is never truncated, tight enough that the stored artifact stays a handful of
// lines on a phone screen.
export const DOOR_KNOCKING_TALKING_POINT_MAX_LENGTH = 400
export const DOOR_KNOCKING_TALKING_POINTS_MAX_LENGTH = 2000
export const DOOR_KNOCKING_INSTRUCTIONS_MAX_LENGTH = 500

// The three sections the model writes, named.
//
// `engagementQuestion` closes the introduction the app composes — the light
// question product's template asks for, so the opener invites a response
// rather than starting a monologue. It is generated rather than a per-purpose
// constant because the natural question needs data: "did you know early voting
// has already started?" is a claim that varies by state, and hardcoding it
// would put a falsehood in some canvassers' mouths at every door.
//
// The identity clause it follows stays composed, because that is where being
// wrong means a volunteer claiming to be the candidate.
//
// The card's two remaining sections are neither generated nor sent back here.
// The CTA is composed from `campaign.details.website`, real data a model that
// phrases it could also invent; the closing is a constant, which is what the
// template says it is.
export const DoorKnockingTalkingPointsDraftResponseSchema = z.object({
  engagementQuestion: z
    .string()
    .min(1)
    .max(DOOR_KNOCKING_TALKING_POINT_MAX_LENGTH),
  context: z.string().min(1).max(DOOR_KNOCKING_TALKING_POINT_MAX_LENGTH),
  ask: z.string().min(1).max(DOOR_KNOCKING_TALKING_POINT_MAX_LENGTH),
})
export type DoorKnockingTalkingPointsDraftResponse = z.infer<
  typeof DoorKnockingTalkingPointsDraftResponseSchema
>
