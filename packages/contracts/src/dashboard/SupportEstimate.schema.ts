import { z } from 'zod'

/**
 * The Serve dashboard hero number: "N of M constituents likely support you".
 * Produced by data + research keyed on electedOfficeId; gp-api only reads it.
 */
export const SupportEstimateSchema = z.object({
  likelySupport: z.number().int().nonnegative(),
  districtSize: z.number().int().nonnegative(),
  percentOfDistrict: z.number().min(0).max(100),
  trendVsLastMonth: z.number(),
})
export type SupportEstimate = z.infer<typeof SupportEstimateSchema>
