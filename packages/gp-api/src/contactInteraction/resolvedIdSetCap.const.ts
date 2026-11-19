// Mirrors people-api's MAX_ID_FILTER_VALUES
// (people-api/src/people/schemas/filters.schema.utils.ts). Enforced again
// here so an over-large resolution 400s with a filter-specific message
// before the wasted people-api round trip (which would otherwise reject the
// same set with a generic Zod error). Exported so other id-set producers
// against the same `id` transport (e.g. the opt-out scrub in
// p2pPhoneListUpload.service.ts) check against the same cap instead of
// duplicating the literal.
//
// Its own module so src/test-app-env-mock.ts can lower it per test through
// appEnvOverrides.MAX_RESOLVED_ID_SET_SIZE instead of seeding 200k rows.
export const MAX_RESOLVED_ID_SET_SIZE = 200_000
