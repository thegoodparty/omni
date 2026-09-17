import { z } from 'zod'
import {
  RecommendedListChannelSchema,
  RecommendedListIntentSchema,
} from '@goodparty_org/contracts'

export const GetRecommendedListsQuerySchema = z.object({
  channel: RecommendedListChannelSchema,
  intent: RecommendedListIntentSchema.optional(),
})

export type GetRecommendedListsQuery = z.infer<
  typeof GetRecommendedListsQuerySchema
>
