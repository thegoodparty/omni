import { z } from 'zod'
import { PriorityRepresentationSchema } from '../priorities/PriorityResults.schema'

// Serve's citizens' panel at a glance (GET /v1/contacts/civic-panel).
// `reachedRecently` uses the same rule as the notContactedRecently list
// filter, so askableNow matches what a "Not contacted in the last 30 days"
// panel list holds. The two always add up to members.
export const CivicPanelSummarySchema = z.object({
  members: z.number().int(),
  reachedRecently: z.number().int(),
  askableNow: z.number().int(),
})
export type CivicPanelSummary = z.infer<typeof CivicPanelSummarySchema>

// How the places panel members live compare with the whole district
// (GET /v1/contacts/civic-panel/representation). Same math, threshold and
// census source as a priority's results; null below the minimum.
export const CivicPanelRepresentationSchema = z.object({
  representation: PriorityRepresentationSchema.nullable(),
})
export type CivicPanelRepresentation = z.infer<
  typeof CivicPanelRepresentationSchema
>
