import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

// Both params optional WITHOUT a one-of refine: a param-less request is
// valid — the controller derives the district from the caller's
// organization, and throws its own BadRequest when nothing resolves.
const getOnboardingStatsQuerySchema = z.object({
  districtId: z.string().min(1).optional(),
  ballotReadyPositionId: z.string().min(1).optional(),
})

export class GetOnboardingStatsQueryDTO extends createZodDto(
  getOnboardingStatsQuerySchema,
) {}

const districtStatsBucketSchema = z.object({
  label: z.string(),
  count: z.number(),
  percent: z.number(),
})

const districtStatCategorySchema = z.array(districtStatsBucketSchema)

export const onboardingStatsResponseSchema = z.object({
  districtId: z.string(),
  computedAt: z.string().optional(),
  totalConstituents: z.number(),
  totalConstituentsWithCellPhone: z.number(),
  buckets: z.object({
    age: districtStatCategorySchema,
    homeowner: districtStatCategorySchema,
    education: districtStatCategorySchema,
    presenceOfChildren: districtStatCategorySchema,
    estimatedIncomeRange: districtStatCategorySchema,
  }),
})
