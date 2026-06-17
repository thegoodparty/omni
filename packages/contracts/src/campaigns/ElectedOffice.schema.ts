import { z } from 'zod'

export const ElectedOfficeSchema = z.object({
  id: z.string(),
  organizationSlug: z.string(),
  swornInDate: z.coerce.date().nullish(),
  electedDate: z.coerce.date().nullish(),
  termStartDate: z.coerce.date().nullish(),
  termEndDate: z.coerce.date().nullish(),
  termLengthDays: z.number().nullish(),
  isActive: z.boolean(),
  party: z.string().nullish(),
  pledgedAt: z.coerce.date().nullish(),
  onboardingCompletedAt: z.coerce.date().nullish(),
  userId: z.number(),
  campaignId: z.number().nullish(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export type ElectedOffice = z.infer<typeof ElectedOfficeSchema>
