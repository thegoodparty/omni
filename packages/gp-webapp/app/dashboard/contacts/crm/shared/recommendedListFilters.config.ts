// The filter dimensions added as groundwork for recommended lists, kept out
// of filters.config.ts on purpose. That config is rendered by five other
// surfaces (the legacy flag-off FiltersSheet, door-knocking's WhoStep and
// TurfDetailsSheet, the outreach v2 builders) which must not gain these
// groups, and the wizard shows them only behind win-recommended-lists.
//
// Serialization is NOT gated: voterFileFilterTransform.util.ts merges these
// keys in unconditionally, so a list saved while the flag was on keeps
// round-tripping after it flips off.
//
// Labels are title case to match filters.config.ts — CRM surfaces
// sentence-case group labels at render time (labels.util.ts). Keep them in
// step with gp-api's filterDimensions.catalog.ts by eye; the two cannot
// import each other.
export const AFFINITY_FIELD_KEY = 'independent_affinity'

// Win-only field keys. The recommended-list dimensions are a Win product
// surface and gp-api 400s them for an eo- org, so they are stripped at both
// the write side (VoterFileStep) and the read side (ListFilterSummary).
// This is a permanent PRODUCT rule and has nothing to do with
// win-recommended-lists, which only decides whether the wizard shows the
// groups at all. hasAnyPhone is deliberately absent: plain contactability,
// and Serve runs phone banking and robocall too.
export const WIN_ONLY_RECOMMENDED_FIELD_KEYS = [AFFINITY_FIELD_KEY, 'ideology']

export const RECOMMENDED_LIST_FILTER_FIELDS = [
  {
    // Win-only, like political party: openness to voting for an independent
    // describes electoral behavior toward a candidate. gp-api 400s it for an
    // eo- org (assertNoRecommendedListFilterForElectedOffice).
    key: AFFINITY_FIELD_KEY,
    label: 'Independent Affinity',
    options: [{ key: 'independentAffinity', label: 'Open to Independents' }],
  },
  {
    // The mart column's value for the third option is `Liberal`; house copy
    // says Progressive, so the persisted key follows the data and only the
    // label differs. Unknown covers the ~40% of the file with no modeled
    // ideology and is a real segment, not a gap to drop. Win-only alongside
    // affinity (gp-api 400s both for an eo- org).
    key: 'ideology',
    label: 'Ideology',
    options: [
      { key: 'ideologyConservative', label: 'Conservative' },
      { key: 'ideologyModerate', label: 'Moderate' },
      { key: 'ideologyLiberal', label: 'Progressive' },
      { key: 'ideologyUnknown', label: 'Unknown' },
    ],
  },
]

// hasAnyPhone is the OR of hasCellPhone and hasLandline, which AND together,
// so it cannot be expressed by combining them — it has to be its own option.
// Selecting it alongside either is redundant rather than contradictory (every
// phone option is presence-only, so hasAnyPhone AND hasCellPhone is just
// hasCellPhone), but a redundant selection reads as a bug to the person who
// made it, so the wizard treats the three as mutually exclusive of the
// "any" option. gp-api keeps plain AND semantics.
export const ANY_PHONE_FILTER_KEY = 'hasAnyPhone'

export const SPECIFIC_PHONE_FILTER_KEYS = ['hasCellPhone', 'hasLandline']

export const ANY_PHONE_FIELD = {
  key: 'any_phone',
  label: 'Phone',
  options: [{ key: ANY_PHONE_FILTER_KEY, label: 'Has Any Phone' }],
}

export const RECOMMENDED_LIST_FILTER_OPTION_KEYS = [
  ...RECOMMENDED_LIST_FILTER_FIELDS.flatMap((field) =>
    field.options.map((option) => option.key),
  ),
  ANY_PHONE_FILTER_KEY,
]
