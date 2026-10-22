import { z } from 'zod'
import { zDate } from '../shared/Date.schema'

// The built-in `segment` for the panel's members on the contacts list,
// download and people reads: no saved list behind it, so it is always the
// current members and never a copy in the lists index.
export const CIVIC_PANEL_SEGMENT = 'civicPanel'

// Serve's civic panel at a glance (GET /v1/contacts/civic-panel).
// `reachedRecently` uses the same rule as the notContactedRecently list
// filter, so askableNow matches what a "Not contacted in the last 30 days"
// panel list holds. The two always add up to members. `lastOutreachAt` is
// the newest row of the built-in list's outreach history (a send that
// reached a current member), null when there is none.
export const CivicPanelSummarySchema = z.object({
  members: z.number().int(),
  reachedRecently: z.number().int(),
  askableNow: z.number().int(),
  lastOutreachAt: zDate().nullable(),
})
export type CivicPanelSummary = z.infer<typeof CivicPanelSummarySchema>
