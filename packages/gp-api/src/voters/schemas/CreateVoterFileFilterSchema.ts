import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import {
  RecommendedListChannelSchema,
  RecommendedListFilterSchema,
  RecommendedListIntentSchema,
  RecommendedListVariantSchema,
} from '@goodparty_org/contracts'
import { voterFilterBaseSchema } from '../../shared/schemas/voterFilterBase.schema'

export class CreateVoterFileFilterSchema extends createZodDto(
  voterFilterBaseSchema.extend({
    name: z.string().min(1).optional(),
    // The four fields below are the recommended-lists provenance. variant/
    // channel/intent map 1:1 onto persisted columns; recommendedFilter is
    // input-only — the recommendation's own filter snapshot, used solely to
    // compute recommendedModified at create time (never persisted itself).
    recommendedVariant: RecommendedListVariantSchema.optional(),
    recommendedChannel: RecommendedListChannelSchema.optional(),
    recommendedIntent: RecommendedListIntentSchema.optional(),
    recommendedFilter: RecommendedListFilterSchema.optional(),
  }),
) {}
