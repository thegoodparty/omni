import { z } from 'zod'
import { UnderrepresentedGroupSchema } from '../priorities/PriorityResults.schema'

// Reaching the residents a civic panel's texts could not: a group still
// short of its seats, worked at the door or on a call
// (POST /v1/contacts/civic-panel/reach-lists). Joining stays a yes marked at
// the door or on the call; this only saves who to knock on or call.

export const CIVIC_PANEL_REACH_CHANNELS = ['door', 'phone'] as const
export const CivicPanelReachChannelSchema = z.enum(CIVIC_PANEL_REACH_CHANNELS)
export type CivicPanelReachChannel = z.infer<
  typeof CivicPanelReachChannelSchema
>

// A group still short, as the civic panel page lists it: an age band,
// gender or race group, or a place (its census tract, or its precinct as
// `county|precinct`). "Some parts of your district" names no one, so it has
// no list.
export const CivicPanelReachGroupSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('group'),
    group: UnderrepresentedGroupSchema.exclude(['unreachedAreas']),
  }),
  z.object({
    kind: z.literal('tract'),
    key: z.string().regex(/^\d{11}$/),
  }),
  z.object({
    kind: z.literal('precinct'),
    key: z
      .string()
      .min(3)
      .max(200)
      .regex(/^[^|]+\|.+$/),
  }),
])
export type CivicPanelReachGroup = z.infer<typeof CivicPanelReachGroupSchema>

export const CreateCivicPanelReachListInputSchema = z.object({
  group: CivicPanelReachGroupSchema,
  channel: CivicPanelReachChannelSchema,
  // The list's name in the official's lists, as the button that made it
  // reads ("Knock doors in West Asheville").
  name: z.string().trim().min(1).max(120),
})
export type CreateCivicPanelReachListInput = z.infer<
  typeof CreateCivicPanelReachListInputSchema
>

// The saved list and how many people it holds.
export const CivicPanelReachListResponseSchema = z.object({
  listId: z.number().int().positive(),
  people: z.number().int().positive(),
})
export type CivicPanelReachList = z.infer<
  typeof CivicPanelReachListResponseSchema
>
