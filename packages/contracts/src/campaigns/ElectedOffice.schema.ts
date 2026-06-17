import { z } from 'zod'

export const ElectedOfficeSchema = z.object({
  id: z.string(),
  organizationSlug: z.string(),
  swornInDate: z.coerce.date().nullish(),
  electedDate: z.coerce.date().nullish(),
  termStartAt: z.coerce.date().nullish(),
  termEndAt: z.coerce.date().nullish(),
  termLengthDays: z.number().nullish(),
  isActive: z.boolean(),
  userId: z.number(),
  campaignId: z.number().nullish(),
})

export type ElectedOffice = z.infer<typeof ElectedOfficeSchema>
