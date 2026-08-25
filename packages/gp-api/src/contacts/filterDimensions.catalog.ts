import {
  type ActivityConditionAction,
  SupportStatusRollupSchema,
} from '@goodparty_org/contracts'
import {
  ACTIVITY_CONDITION_CHANNEL_ACTIONS,
  type ActivityConditionChannel,
} from '@/shared/schemas/activityCondition.schema'
import {
  AUDIENCE_VOTER_STATUS_VALUES,
  CONTACTS_MADE_BUCKET_FIELDS,
  INCOME_RANGE_MAPPING,
  LANGUAGE_CODE_TO_LABEL,
} from './utils/voterFileFilter.utils'

// The one server-side catalog of what a contacts filter can express: every
// filterable voterFilterBaseSchema field group, plus supportStatus and the
// activity-condition branch. The AI assistant's describe/count tools read it
// through ContactsService.getFilterDimensions, which strips Win-only
// dimensions (party) for `eo-` orgs.
//
// The webapp wizard renders a parallel expression of this knowledge in
// packages/gp-webapp/app/dashboard/contacts/ (filters.config.ts and
// crm/shared/*), which cannot be imported across packages — keep labels
// aligned with it by eye. Precinct and top-issue are deliberately absent
// (blocked dimensions; adding them later is additive).

export type FilterDimensionMode = 'win' | 'serve' | 'both'

// How a dimension's underlying value came to exist, so the assistant hedges
// correctly. Set on every entry we have a real source for. Optional rather
// than required: two dimensions (children, languageCodes) have no confirmed
// source yet (checked serve/output/l2_haystaq_codebook — that's the L2
// National Models User Guide, which only covers hs_* opinion scores, not
// these base demographic columns) and are deliberately left unmarked rather
// than guessed. FILTER_DIMENSION_PROVENANCE_RULES tells the model to treat
// an unmarked dimension with the same caution as "modeled" until someone
// sources the real answer (check the gp-data-platform column seed or ask
// the data team) and a follow-up PR adds the mark.
export type FilterDimensionProvenance = 'observed' | 'modeled' | 'derived'

// The one rule telling the model what a provenance mark obliges it to say.
// Lives next to the union it glosses so the vocabulary and its meaning cannot
// drift apart (see Chief of Staff evals D3-05, QR-08). Imported by
// describeFilterDimensions.tool.ts (reaching both the Win and Serve handlers)
// and by the Chief of Staff prompt's CRM_TOOLS_RULES — never restated.
// Deliberately uses neither "voter" nor "constituent": Win and Serve mandate
// opposite nouns for the people this data describes. The last bullet's
// "Unknown is reportable, never drop it" rule parallels the null-handling
// rule in llm/tools/hsScoreSemantics.ts — same idea applied to a categorical
// filter value instead of a SQL NULL, not merged because the mechanics
// differ, but keep both in mind if either changes.
export const FILTER_DIMENSION_PROVENANCE_RULES = `DIMENSION PROVENANCE (every dimension carries a \`provenance\` field — misreading it produces false claims):
  - "observed": a recorded fact on the file — a registration record, a contact detail on file, or an interaction this organization logged. Report these plainly, as facts about the file.
  - "modeled": an ESTIMATE about the person from a vendor or in-house model, or a sparse third-party data match — NOT something they told anyone. The underlying value often literally reads "Likely"/"Probable"/"Estimated"/"Inferred"; that qualifier is stripped from the label you see, so the field carries it instead.
  - "derived": computed from this organization's own records, so it only covers people already contacted. "Unknown" there means no one asked, never "no".
  - Whenever you report a count, share, ranking, or "largest group" built from a modeled dimension, say it is modeled or estimated IN THE SAME SENTENCE as the number ("an estimated 1,200 ...", "modeled data puts the largest group at ..."). A caveat trailing after the claim does not count. This constrains how you FRAME the result — it does not license explaining which field, column, or model produced it.
  - The count itself is an exact count of matching RECORDS. What is uncertain is the ATTRIBUTE and the COVERAGE: on a modeled dimension with no negative value, a positive count is a FLOOR on how many people have the trait, never a total — most such dimensions are mostly null.
  - "Unknown" is a real, reportable segment on most dimensions and is often large. State its size rather than dropping it, and never fold it into another value.
  - A dimension with NO provenance field has not been classified yet, not confirmed as a plain fact. Treat it exactly like "modeled": hedge any claim built from it rather than stating it as fact.`

export interface FilterDimensionValue {
  key: string
  label: string
}

export interface ActivityChannelValue extends FilterDimensionValue {
  actions: FilterDimensionValue[]
}

interface FilterDimensionBase {
  key: string
  label: string
  modes: FilterDimensionMode
  provenance?: FilterDimensionProvenance
}

// boolean-group: each value key is a voterFilterBaseSchema boolean field set
// to true to select it.
export interface BooleanGroupFilterDimension extends FilterDimensionBase {
  kind: 'boolean-group'
  values: FilterDimensionValue[]
}

// multi-value: the dimension key is a voterFilterBaseSchema array field; each
// value key is an accepted entry for that array.
export interface MultiValueFilterDimension extends FilterDimensionBase {
  kind: 'multi-value'
  values: FilterDimensionValue[]
}

// activity: the activityConditions branch — values are the channels with an
// interaction model, each carrying its own outcome (action) vocabulary.
export interface ActivityFilterDimension extends FilterDimensionBase {
  kind: 'activity'
  values: ActivityChannelValue[]
}

export type FilterDimension =
  | BooleanGroupFilterDimension
  | MultiValueFilterDimension
  | ActivityFilterDimension

const ACTIVITY_CHANNEL_LABELS: Record<ActivityConditionChannel, string> = {
  text: 'Text',
  p2p: 'P2P Text',
  doorKnocking: 'Door Knocking',
  robocall: 'Robocall',
  phoneBanking: 'Phone Banking',
}

const ACTIVITY_ACTION_LABELS: Record<ActivityConditionAction, string> = {
  responded: 'Responded',
  no_response: 'No Response',
  opted_out: 'Opted Out',
  answered: 'Answered',
  not_home: 'Not Home',
  refused_to_engage: 'Refused to Engage',
  support_yes: 'Support: Yes',
  support_unsure: 'Support: Unsure',
  support_no: 'Support: No',
  voicemail_left: 'Voicemail Left',
  no_answer: 'No Answer',
  voicemail: 'Voicemail',
  wrong_number: 'Wrong Number',
  refused: 'Refused',
}

// All five values (ENG-10837): `undecided`/`refused` (ENG-10833) exist only
// as manual overrides, but SupportStatusService.personIdsByEffectiveStatus
// now resolves overrides alongside derivation, so advertising them here no
// longer risks a filter that silently matches zero people.
const SUPPORT_STATUS_LABELS: Record<
  (typeof SupportStatusRollupSchema.options)[number],
  string
> = {
  supporter: 'Supporter',
  non_supporter: 'Non-supporter',
  unknown: 'Support Unknown',
  undecided: 'Undecided',
  refused: 'Refused',
}

// The exhaustive ACTIVITY_CHANNEL_LABELS record breaks the build when a new
// channel joins ActivityConditionChannel; the catalog unit test pins this list
// to ACTIVITY_CONDITION_CHANNEL_ACTIONS' keys so it can't fall behind either.
const ACTIVITY_CHANNELS: readonly ActivityConditionChannel[] = [
  'text',
  'p2p',
  'doorKnocking',
  'robocall',
  'phoneBanking',
]

const activityChannelValue = (
  channel: ActivityConditionChannel,
): ActivityChannelValue => ({
  key: channel,
  label: ACTIVITY_CHANNEL_LABELS[channel],
  actions: ACTIVITY_CONDITION_CHANNEL_ACTIONS[channel].map((action) => ({
    key: action,
    label: ACTIVITY_ACTION_LABELS[action],
  })),
})

export const FILTER_DIMENSIONS: readonly FilterDimension[] = [
  {
    key: 'audience',
    label: 'Voter Likelihood',
    kind: 'boolean-group',
    modes: 'both',
    provenance: 'modeled',
    values: AUDIENCE_VOTER_STATUS_VALUES.map(({ field, value }) => ({
      key: field,
      label: value,
    })),
  },
  {
    key: 'party',
    label: 'Political Party',
    kind: 'boolean-group',
    modes: 'win',
    provenance: 'observed',
    values: [
      { key: 'partyDemocrat', label: 'Democrat' },
      { key: 'partyIndependent', label: 'Independent' },
      { key: 'partyRepublican', label: 'Republican' },
      { key: 'partyOther', label: 'Other' },
    ],
  },
  {
    // Every logged interaction row across text/robocall/door-knock,
    // regardless of outcome (ENG-10839) — campaign activity, so Win-only
    // like party.
    key: 'contactsMade',
    label: 'Prior Contacts Made',
    kind: 'boolean-group',
    modes: 'win',
    provenance: 'observed',
    values: CONTACTS_MADE_BUCKET_FIELDS.map(({ field, bucket }) => ({
      key: field,
      label: bucket === 5 ? '5+' : String(bucket),
    })),
  },
  {
    key: 'age',
    label: 'Age',
    kind: 'boolean-group',
    modes: 'both',
    provenance: 'observed',
    values: [
      { key: 'age18_24', label: '18-24' },
      { key: 'age25_34', label: '25-34' },
      { key: 'age35_49', label: '35-49' },
      { key: 'age50_64', label: '50-64' },
      { key: 'age65Plus', label: '65+' },
      { key: 'ageUnknown', label: 'Unknown' },
    ],
  },
  {
    key: 'gender',
    label: 'Gender',
    kind: 'boolean-group',
    modes: 'both',
    provenance: 'observed',
    values: [
      { key: 'genderMale', label: 'Male' },
      { key: 'genderFemale', label: 'Female' },
      { key: 'genderUnknown', label: 'Unknown' },
    ],
  },
  {
    key: 'phone',
    label: 'Phone',
    kind: 'boolean-group',
    modes: 'both',
    provenance: 'observed',
    values: [
      { key: 'hasCellPhone', label: 'Has Cell Phone' },
      { key: 'hasLandline', label: 'Has Landline' },
    ],
  },
  {
    key: 'languageCodes',
    label: 'Language',
    kind: 'multi-value',
    modes: 'both',
    // No provenance mark: checked serve/output/l2_haystaq_codebook (the L2
    // National Models User Guide) and it only documents hs_* opinion-score
    // models, not this column. Source the real answer (the gp-data-platform
    // column seed, or the data team) before marking this observed/modeled.
    values: Object.entries(LANGUAGE_CODE_TO_LABEL).map(([key, label]) => ({
      key,
      label,
    })),
  },
  {
    key: 'maritalStatus',
    label: 'Marital Status',
    kind: 'boolean-group',
    modes: 'both',
    // Dimension-level mark; Married/Single are consumer-data values same as
    // the Likely* pair, so 'modeled' is the conservative read for all five.
    provenance: 'modeled',
    values: [
      { key: 'married', label: 'Married' },
      { key: 'likelyMarried', label: 'Likely Married' },
      { key: 'single', label: 'Single' },
      { key: 'likelySingle', label: 'Likely Single' },
      { key: 'maritalUnknown', label: 'Unknown' },
    ],
  },
  {
    key: 'children',
    label: 'Children',
    kind: 'boolean-group',
    modes: 'both',
    // No provenance mark: checked serve/output/l2_haystaq_codebook (the L2
    // National Models User Guide) and it only documents hs_* opinion-score
    // models, not this column. Source the real answer (the gp-data-platform
    // column seed, or the data team) before marking this observed/modeled.
    values: [
      { key: 'hasChildrenYes', label: 'Yes' },
      { key: 'hasChildrenNo', label: 'No' },
      { key: 'hasChildrenUnknown', label: 'Unknown' },
    ],
  },
  {
    key: 'veteran',
    label: 'Veteran Status',
    kind: 'boolean-group',
    modes: 'both',
    // Presence-of-append flag, no negative value (~97% null) — the rule
    // text's FLOOR clause is what keeps a positive count honest.
    provenance: 'modeled',
    values: [
      { key: 'veteranYes', label: 'Yes' },
      { key: 'veteranUnknown', label: 'Unknown' },
    ],
  },
  {
    key: 'homeowner',
    label: 'Homeownership',
    kind: 'boolean-group',
    modes: 'both',
    // Column is Homeowner_Probability_Model; every value including
    // 'Homeowner' comes out of that model, not a deed record. 'Homeowner'
    // folds in the model's Probable Home Owner bucket (ENG-10947) —
    // homeownerLikely is a legacy wire key still accepted from saved
    // filters, but no longer offered as its own option.
    provenance: 'modeled',
    values: [
      { key: 'homeownerYes', label: 'Homeowner' },
      { key: 'homeownerNo', label: 'Renter' },
      { key: 'homeownerUnknown', label: 'Unknown' },
    ],
  },
  {
    key: 'businessOwner',
    label: 'Business Owner',
    kind: 'boolean-group',
    modes: 'both',
    // Presence-of-append flag, no negative value — same shape as veteran.
    provenance: 'modeled',
    values: [
      { key: 'businessOwnerYes', label: 'Yes' },
      { key: 'businessOwnerUnknown', label: 'Unknown' },
    ],
  },
  {
    key: 'education',
    label: 'Level of Education',
    kind: 'boolean-group',
    modes: 'both',
    provenance: 'modeled',
    values: [
      { key: 'educationNone', label: 'None' },
      { key: 'educationHighSchoolDiploma', label: 'High School Diploma' },
      { key: 'educationTechnicalSchool', label: 'Technical School' },
      { key: 'educationSomeCollege', label: 'Some College' },
      { key: 'educationCollegeDegree', label: 'College Degree' },
      { key: 'educationGraduateDegree', label: 'Graduate Degree' },
      { key: 'educationUnknown', label: 'Unknown' },
    ],
  },
  {
    key: 'ethnicity',
    label: 'Ethnicity',
    kind: 'boolean-group',
    modes: 'both',
    provenance: 'modeled',
    values: [
      { key: 'ethnicityAfricanAmerican', label: 'African American' },
      { key: 'ethnicityAsian', label: 'Asian' },
      { key: 'ethnicityEuropean', label: 'European' },
      { key: 'ethnicityHispanic', label: 'Hispanic' },
      { key: 'ethnicityOther', label: 'Other' },
      { key: 'ethnicityUnknown', label: 'Unknown' },
    ],
  },
  {
    key: 'incomeRanges',
    label: 'Household Income Range',
    kind: 'multi-value',
    modes: 'both',
    // Same Estimated_Income_Amount_Int column as 'income' below — keep the
    // two marks in sync (pinned by test).
    provenance: 'modeled',
    values: Object.keys(INCOME_RANGE_MAPPING).map((range) => ({
      key: range,
      label: range,
    })),
  },
  {
    key: 'income',
    label: 'Household Income Unknown',
    kind: 'boolean-group',
    modes: 'both',
    // Same Estimated_Income_Amount_Int column as 'incomeRanges' above.
    provenance: 'modeled',
    values: [{ key: 'incomeUnknown', label: 'Unknown' }],
  },
  {
    // Raw alternative to the audience boolean group: the same people-api
    // voterStatus vocabulary, passed as an array instead of per-value
    // booleans (convertVoterFileFilterToFilters gives this field precedence).
    key: 'voterStatus',
    label: 'Voter Status',
    kind: 'multi-value',
    modes: 'both',
    // Same Voter_Status column as 'audience' above, different spelling —
    // keep the two marks in sync (pinned by test).
    provenance: 'modeled',
    values: AUDIENCE_VOTER_STATUS_VALUES.map(({ value }) => ({
      key: value,
      label: value,
    })),
  },
  {
    key: 'supportStatus',
    label: 'Support Status',
    kind: 'multi-value',
    modes: 'both',
    // Rolled up from this org's own interaction answers plus manual
    // overrides — coverage is limited to people already contacted.
    provenance: 'derived',
    values: SupportStatusRollupSchema.options.map((value) => ({
      key: value,
      label: SUPPORT_STATUS_LABELS[value],
    })),
  },
  {
    key: 'activityConditions',
    label: 'Previous Activity',
    kind: 'activity',
    modes: 'both',
    provenance: 'observed',
    values: ACTIVITY_CHANNELS.map(activityChannelValue),
  },
]
