import { z } from 'zod'

/**
 * The Serve dashboard hero number: "N of M constituents likely support you".
 * gp-api derives this from the election-api elected-office-support row
 * (ElectedOfficeSupport), which the data team's ETL populates. gp-api returns
 * null from the support-estimate endpoint until a row exists for the office.
 */
export const SupportEstimateSchema = z.object({
  likelySupport: z.number().int().nonnegative(),
  districtSize: z.number().int().nonnegative(),
  percentOfDistrict: z.number().min(0).max(100),
})
export type SupportEstimate = z.infer<typeof SupportEstimateSchema>
