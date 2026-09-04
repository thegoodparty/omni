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
    // The three enums are `.nullable()`, not just `.optional()`: a repost of
    // an existing SegmentResponse (duplicate-to-edit) carries these columns
    // as explicit `null`, not an absent key — Zod's silent-strip-unknown-key
    // behavior this schema otherwise relies on only covers absent keys, and
    // a known key with an invalid value is a real 400.
    recommendedVariant: RecommendedListVariantSchema.nullable().optional(),
    recommendedChannel: RecommendedListChannelSchema.nullable().optional(),
    recommendedIntent: RecommendedListIntentSchema.nullable().optional(),
    recommendedFilter: RecommendedListFilterSchema.optional(),
  }),
) {}
