import { z } from 'zod'

export const StrategyExistsResponseSchema = z.object({
  exists: z.boolean(),
})

export type StrategyExistsResponse = z.infer<
  typeof StrategyExistsResponseSchema
>
