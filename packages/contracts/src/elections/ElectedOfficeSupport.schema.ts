import { z } from 'zod'

/**
 * Constituent support for one elected office. Served by election-api and read
 * by gp-api. Keyed on gp-api's ElectedOffice.id; populated by the data team's
 * ETL from the civics mart (interim source: projected_registered_supporters /
 * icp_voter_count). The election-api table is empty until that ETL runs, so
 * gp-api treats a missing row as "no estimate yet".
 */
export const ElectedOfficeSupportSchema = z.object({
  electedOfficeId: z.guid(),
  supportConstituents: z.number().int().nonnegative(),
  totalConstituents: z.number().int().nonnegative(),
})
export type ElectedOfficeSupport = z.infer<typeof ElectedOfficeSupportSchema>
