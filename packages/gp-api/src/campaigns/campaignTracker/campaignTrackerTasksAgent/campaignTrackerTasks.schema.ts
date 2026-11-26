import { z } from 'zod'
import { trackerArtifactSchema } from '../services/campaignTrackerTasks.service'

// The manifest's input_schema in gp-api's names, plus the run's owner. The
// manifest declares `additionalProperties: false`, so the nullables are
// nullable rather than omitted: the dispatcher sends every field, and a
// campaign with no city sends null.
export const CampaignTrackerTasksInputSchema = z.object({
  organizationSlug: z.string().min(1),
  raceId: z.string().min(1),
  userFullName: z.string().min(1),
  mode: z.enum(['initial', 'weekly']),
  today: z.iso.date(),
  // Any string, as the manifest declares it: `details.electionDate` is
  // free-form (a fixture's `toISOString()` value, or an empty string), and a
  // date-shaped check here would refuse on this engine a campaign the PMF
  // Engine runs.
  electionDate: z.string().nullable(),
  state: z.string().nullable(),
  city: z.string().nullable(),
  campaignPlan: z.string().nullable(),
  campaignStory: z.string().nullable(),
})
export type CampaignTrackerTasksInput = z.infer<
  typeof CampaignTrackerTasksInputSchema
>

// The manifest's output_schema, which is also what the PMF Engine's artifacts
// are validated against on the way in — one contract for both engines.
export const CampaignTrackerTasksOutputSchema = trackerArtifactSchema
