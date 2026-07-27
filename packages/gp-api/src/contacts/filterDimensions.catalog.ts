import {
  SupportStatusRollupSchema,
  type ActivityConditionAction,
  type SupportStatusRollup,
} from '@goodparty_org/contracts'
import {
  ACTIVITY_CONDITION_CHANNEL_ACTIONS,
  type ActivityConditionChannel,
} from '@/shared/schemas/activityCondition.schema'
import {
  AUDIENCE_VOTER_STATUS_VALUES,
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
}

const SUPPORT_STATUS_LABELS: Record<SupportStatusRollup, string> = {
  supporter: 'Supporter',
  non_supporter: 'Non-supporter',
  unknown: 'Support Unknown',
}

// The exhaustive ACTIVITY_CHANNEL_LABELS record breaks the build when a new
// channel joins ActivityConditionChannel; the catalog unit test pins this list
// to ACTIVITY_CONDITION_CHANNEL_ACTIONS' keys so it can't fall behind either.
const ACTIVITY_CHANNELS: readonly ActivityConditionChannel[] = [
  'text',
  'p2p',
  'doorKnocking',
  'robocall',
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
    values: [
      { key: 'partyDemocrat', label: 'Democrat' },
      { key: 'partyIndependent', label: 'Independent' },
      { key: 'partyRepublican', label: 'Republican' },
      { key: 'partyUnknown', label: 'Unknown' },
    ],
  },
  {
    key: 'age',
    label: 'Age',
    kind: 'boolean-group',
    modes: 'both',
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
    values: [
      { key: 'veteranYes', label: 'Yes' },
      { key: 'veteranUnknown', label: 'Unknown' },
    ],
  },
  {
    key: 'homeowner',
    label: 'Homeowner',
    kind: 'boolean-group',
    modes: 'both',
    values: [
      { key: 'homeownerYes', label: 'Yes' },
      { key: 'homeownerLikely', label: 'Likely' },
      { key: 'homeownerNo', label: 'No' },
      { key: 'homeownerUnknown', label: 'Unknown' },
    ],
  },
  {
    key: 'businessOwner',
    label: 'Business Owner',
    kind: 'boolean-group',
    modes: 'both',
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
    values: ACTIVITY_CHANNELS.map(activityChannelValue),
  },
]
