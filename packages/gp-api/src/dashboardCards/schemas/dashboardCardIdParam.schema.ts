import { z } from 'zod'

export const DashboardCardIdParamSchema = z.object({
  id: z.string(),
})

export type DashboardCardIdParam = z.infer<typeof DashboardCardIdParamSchema>
