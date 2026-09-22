import { z } from 'zod'
import {
  RecommendedListChannelSchema,
  RecommendedListIntentSchema,
  RecommendedListVariantSchema,
} from '@goodparty_org/contracts'

// No channel = the global universes (every intent, no contactability cut),
// which is what the voter data page lists. A variant names one universe
// regardless of intent, for a flow a candidate entered from that page.
export const GetRecommendedListsQuerySchema = z.object({
  channel: RecommendedListChannelSchema.optional(),
  intent: RecommendedListIntentSchema.optional(),
  variant: RecommendedListVariantSchema.optional(),
})

export type GetRecommendedListsQuery = z.infer<
  typeof GetRecommendedListsQuerySchema
>
