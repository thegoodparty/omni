import { z } from 'zod'
import { TrackerTaskSkipReasonSchema } from '@goodparty_org/contracts'

export const skipTaskBodySchema = z.object({
  reason: TrackerTaskSkipReasonSchema,
})

export type SkipTaskBody = z.infer<typeof skipTaskBodySchema>
