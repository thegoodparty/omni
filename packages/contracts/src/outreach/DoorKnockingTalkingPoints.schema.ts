import { z } from 'zod'
import {
  OutreachPurposeSchema,
  ServeOutreachPurposeSchema,
} from './OutreachPurpose.schema'

// Talking points for a door-knocking list: what the canvasser says, written
// once for the whole list rather than per person at the door.
//
// Modelled on PhoneBankingScript.schema.ts, with one deliberate difference:
// no `tone`. These are notes a canvasser glances at and puts in their own
// words, so there is no prose voice to select.
//
// The talking points are free text, the candidate's to shape. A fresh draft
// is 4 or 5 bullets, each line starting with DOOR_KNOCKING_BULLET; an Improve
// keeps whatever shape the candidate wrote. The walk shows bullet lines as
// bullets and any other line as written (docs/features/door-knocking-talking-points.md).
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

export const DOOR_KNOCKING_TALKING_POINTS_MAX_LENGTH = 2000
export const DOOR_KNOCKING_INSTRUCTIONS_MAX_LENGTH = 500

// What a fresh draft starts each line with. A line the candidate starts with
// it reads as a bullet at the door; any other line reads as written.
export const DOOR_KNOCKING_BULLET = '• '

export const DoorKnockingTalkingPointsDraftResponseSchema = z.object({
  draft: z.string().min(1).max(DOOR_KNOCKING_TALKING_POINTS_MAX_LENGTH),
  // Deploy compatibility only: a webapp tab from before free text reads the
  // three sections it used to edit. Filled from the draft's lines; the current
  // webapp never reads them. Delete once a release has settled.
  engagementQuestion: z.string().optional(),
  context: z.string().optional(),
  ask: z.string().optional(),
})
export type DoorKnockingTalkingPointsDraftResponse = z.infer<
  typeof DoorKnockingTalkingPointsDraftResponseSchema
>
