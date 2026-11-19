import { z } from 'zod'
import { TrendingIssuesOutputSchema } from '../trendingIssuesAgent/trendingIssues.schema'

// The two people marts gp-api's Databricks principal reads. The run's own is
// whichever PeopleDatasetService picks for the org, resolved at dispatch and
// carried here so the tool never has to guess which one this run may read.
export const PEOPLE_MART_TABLES = [
  'goodparty_data_catalog.mart_gp_api.gp_api_voters',
  'goodparty_data_catalog.mart_gp_api.gp_api_constituents',
] as const

export const PeopleMartTableSchema = z.enum(PEOPLE_MART_TABLES)

// The top_community_issues manifest's input_schema, in gp-api's names, plus
// the run's date (~12-month freshness rule) and the people mart this run may
// read. The L2 pair is the office's voter-file district; queryDatabricks scopes
// every query to it, read from this stored input
// (topCommunityIssuesDatabricksScope).
export const TopCommunityIssuesInputSchema = z.object({
  organizationSlug: z.string().min(1),
  state: z.string().regex(/^[A-Z]{2}$/),
  office: z.string().min(1),
  districtDescriptor: z.string().min(1),
  l2DistrictType: z.string().min(1).optional(),
  l2DistrictName: z.string().min(1).optional(),
  peopleTable: PeopleMartTableSchema,
  today: z.iso.date(),
})
export type TopCommunityIssuesInput = z.infer<
  typeof TopCommunityIssuesInputSchema
>

// The manifest's output_schema without organization_slug and
// generated_for_run_id, which gp-api adds (topCommunityIssuesArtifact). The
// issue shape is trending_issues' byte for byte; only the list differs.
export const TopCommunityIssuesOutputSchema = TrendingIssuesOutputSchema.extend(
  { list: z.literal('top_community') },
)
export type TopCommunityIssuesOutput = z.infer<
  typeof TopCommunityIssuesOutputSchema
>

export const topCommunityIssuesArtifact = (
  output: TopCommunityIssuesOutput,
  run: { runId: string; organizationSlug: string },
) => ({
  ...output,
  organization_slug: run.organizationSlug,
  generated_for_run_id: run.runId,
})
