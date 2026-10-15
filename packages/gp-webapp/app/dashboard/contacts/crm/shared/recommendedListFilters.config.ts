// The filter dimensions for recommended lists, kept out of filters.config.ts
// on purpose. That config is rendered by other surfaces (door-knocking's
// WhoStep and TurfDetailsSheet) which must not gain these groups; the
// surfaces that do render them pass VoterFileStep's
// `showRecommendedListFilters`.
//
// Labels are title case to match filters.config.ts — CRM surfaces
// sentence-case group labels at render time (labels.util.ts). Keep them in
// step with gp-api's filterDimensions.catalog.ts by eye; the two cannot
// import each other.
export const AFFINITY_FIELD_KEY = 'independent_affinity'

// Win-only field keys. The recommended-list dimensions are a Win product
// surface and gp-api 400s them for an eo- org, so they are stripped at both
// the write side (VoterFileStep) and the read side (ListFilterSummary).
// This is a permanent PRODUCT rule, independent of which surfaces render the
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

// Serve-only, the inverse of the Win-only fields above: the people on the
// official's civic panel. gp-api resolves it from their standing civic panel
// status and 400s it for a Win org. Kept here with the other non-config
// groups so the transform carries its key and an edit can clear it.
export const CIVIC_PANEL_FILTER_KEY = 'civicPanelMember'

// The status options OR together. Left is someone who was on the panel and
// left; never invited is nobody the office ever asked to join.
export const CIVIC_PANEL_FIELD = {
  key: 'civic_panel',
  label: 'Civic panel',
  options: [
    { key: CIVIC_PANEL_FILTER_KEY, label: 'On your civic panel' },
    { key: 'civicPanelLeft', label: 'Left' },
    { key: 'civicPanelNeverInvited', label: 'Never invited' },
  ],
}

// How a current member last joined. gp-api matches members only.
export const CIVIC_PANEL_JOINED_BY_FIELD = {
  key: 'civic_panel_joined_by',
  label: 'How they joined',
  options: [
    { key: 'civicPanelJoinedByText', label: 'By text' },
    { key: 'civicPanelJoinedByDoor', label: 'At the door' },
    { key: 'civicPanelJoinedByPhone', label: 'On a call' },
    { key: 'civicPanelJoinedByHand', label: 'Added by you' },
  ],
}

// Inclusive calendar days (YYYY-MM-DD). Values are strings, not booleans:
// the one place VoterFileFilters holds anything but a pill.
export interface DayRangeField {
  key: string
  label: string
  fromKey: string
  toKey: string
}

export const CIVIC_PANEL_JOINED_WHEN_FIELD: DayRangeField = {
  key: 'civic_panel_joined_when',
  label: 'When they joined',
  fromKey: 'civicPanelJoinedFrom',
  toKey: 'civicPanelJoinedTo',
}

// When the office last reached them on any channel, the same rule as the
// 30-day rest window, so its pill is that window's key.
export const LAST_ASKED_RANGE_FIELD: DayRangeField = {
  key: 'last_asked',
  label: 'Last asked',
  fromKey: 'lastReachedFrom',
  toKey: 'lastReachedTo',
}

export const DAY_RANGE_FILTER_KEYS = [
  CIVIC_PANEL_JOINED_WHEN_FIELD,
  LAST_ASKED_RANGE_FIELD,
].flatMap((field) => [field.fromKey, field.toKey])

// Both products: a rest window that leaves out anyone the office reached on
// any channel in the last 30 days (gp-api CONTACT_REST_DAYS), so the same
// people are not asked twice in a month.
export const NOT_CONTACTED_RECENTLY_FILTER_KEY = 'notContactedRecently'

// Serve's spelling of the rest window, under the panel's other groups.
export const LAST_ASKED_FIELD = {
  key: 'last_asked',
  label: 'Last asked',
  options: [
    {
      key: NOT_CONTACTED_RECENTLY_FILTER_KEY,
      label: 'Not in the last 30 days',
    },
  ],
}

export const CONTACT_HISTORY_FIELD = {
  key: 'contact_history',
  label: 'Contact History',
  options: [
    {
      key: NOT_CONTACTED_RECENTLY_FILTER_KEY,
      label: 'Not Contacted In The Last 30 Days',
    },
  ],
}

export const RECOMMENDED_LIST_FILTER_OPTION_KEYS = [
  ...RECOMMENDED_LIST_FILTER_FIELDS.flatMap((field) =>
    field.options.map((option) => option.key),
  ),
  ANY_PHONE_FILTER_KEY,
  ...CIVIC_PANEL_FIELD.options.map((option) => option.key),
  ...CIVIC_PANEL_JOINED_BY_FIELD.options.map((option) => option.key),
  NOT_CONTACTED_RECENTLY_FILTER_KEY,
]
