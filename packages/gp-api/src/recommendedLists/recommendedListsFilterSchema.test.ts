import { describe, expect, it } from 'vitest'
import {
  RECOMMENDED_LIST_CHANNEL_VALUES,
  RECOMMENDED_LIST_VARIANT_VALUES,
  RecommendedListFilterSchema,
} from '@goodparty_org/contracts'
import { RECOMMENDED_LISTS_REGISTRY } from './recommendedLists.registry'
import { buildVariantFilter } from './recommendedListsUniverse.util'

// Guards the wire contract, not the universe logic (recommendedListsUniverse
// .util.test.ts owns that): RecommendedListFilterSchema in contracts is a
// deliberately narrow, closed schema -- only the fields buildVariantFilter
// ever emits, not the full ~90-field VoterFilterBase. Nothing else parses
// against it, so a variant that starts populating a field outside that set
// would otherwise surface as a runtime 500 from ZodResponseInterceptor, not
// a compile error or a failing test -- exactly the trap for whoever adds a
// list the way the registry invites (a registry entry plus a copy string).
describe('RecommendedListFilterSchema covers every variant filter', () => {
  for (const variant of RECOMMENDED_LIST_VARIANT_VALUES) {
    for (const channel of RECOMMENDED_LIST_CHANNEL_VALUES) {
      it(`parses ${variant} on ${channel}`, () => {
        const ideologyBucket = RECOMMENDED_LISTS_REGISTRY[variant]
          .requiresIdeologyBucket
          ? 'progressive'
          : null
        const filter = buildVariantFilter(variant, channel, ideologyBucket)

        expect(filter).not.toBeNull()
        expect(RecommendedListFilterSchema.safeParse(filter).success).toBe(true)
      })
    }
  }
})
