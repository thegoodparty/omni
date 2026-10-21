import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import {
  GeoJsonShapeSchema,
  GeoShapeLabelsSchema,
  ListSampleSchema,
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
    // Deliberately here and on the update schema rather than on
    // voterFilterBaseSchema: that one is shared with the P2P phone-list path
    // and door knocking's own filter grammar, both of which already have a
    // polygon of their own to mean something else by.
    geoPoly: GeoJsonShapeSchema.nullable().optional(),
    // One name and colour per part of `geoPoly`, in the same order.
    geoPolyLabels: GeoShapeLabelsSchema.nullable().optional(),
    // The chat card this list is being created from, if any. A second
    // create under the same key returns the first list instead of a twin.
    proposalKey: z.string().uuid().optional(),
    // Create-only: a sample is drawn once, when the list is saved, and the
    // update schema has nothing to redraw it with.
    sample: ListSampleSchema.optional(),
    // Serve, from a priority's card: keep the list to the parts of the
    // district that priority's answers have barely reached. gp-api draws
    // the area and saves it as the list's boundary; the request carries no
    // geometry of its own.
    unreachedAreaOfPriorityId: z.string().min(1).optional(),
    // Serve: the audience of a civic panel invite. The outreach that used
    // the list keeps it, and the lists index leaves it out, since the
    // panel's one list is the built-in Civic panel row. Create-only.
    civicPanelInvite: z.boolean().optional(),
  }),
) {}
