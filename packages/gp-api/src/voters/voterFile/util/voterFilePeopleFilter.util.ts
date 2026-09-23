import { VoterFileFilter } from '../../../generated/prisma'
import {
  CustomFilter,
  CustomVoterFile,
  VoterFileType,
} from '../voterFile.types'

type BooleanFilterField = {
  [K in keyof VoterFileFilter]: [VoterFileFilter[K]] extends [boolean | null]
    ? K
    : never
}[keyof VoterFileFilter]

// Legacy underscore filter keys -> the VoterFileFilter boolean columns that
// convertVoterFileFilterToFilters already resolves for the CRM, so both
// surfaces send people-api the same FilterObject vocabulary.
// `audience_request` is a UI-only sentinel the legacy SQL builder ignored too.
const CUSTOM_FILTER_TO_FIELD: Record<
  Exclude<CustomFilter, 'audience_request'>,
  BooleanFilterField
> = {
  audience_superVoters: 'audienceSuperVoters',
  audience_likelyVoters: 'audienceLikelyVoters',
  audience_unreliableVoters: 'audienceUnreliableVoters',
  audience_unlikelyVoters: 'audienceUnlikelyVoters',
  audience_unknown: 'audienceUnknown',
  party_independent: 'partyIndependent',
  party_democrat: 'partyDemocrat',
  party_republican: 'partyRepublican',
  party_other: 'partyOther',
  age_18_25: 'age18_25',
  age_25_35: 'age25_35',
  age_35_50: 'age35_50',
  age_50_plus: 'age50Plus',
  gender_male: 'genderMale',
  gender_female: 'genderFemale',
  gender_unknown: 'genderUnknown',
  has_cell_phone: 'hasCellPhone',
  has_landline: 'hasLandline',
  ethnicity_european: 'ethnicityEuropean',
  ethnicity_asian: 'ethnicityAsian',
  ethnicity_hispanic: 'ethnicityHispanic',
  ethnicity_african_american: 'ethnicityAfricanAmerican',
}

// Per-channel population rules, mirroring segmentsToFiltersMap.const.ts (the
// CRM's built-in segments): sms/digitalAds reach cell phones,
// telemarketing/robocall reach landlines, doorKnocking de-dupes to one voter
// per physical residence (a canvasser walks houses, not registrations).
const TYPE_OVERRIDES: Record<
  VoterFileType,
  { fields?: BooleanFilterField[]; groupByHousehold?: boolean }
> = {
  [VoterFileType.full]: {},
  [VoterFileType.custom]: {},
  [VoterFileType.sms]: { fields: ['hasCellPhone'] },
  [VoterFileType.digitalAds]: { fields: ['hasCellPhone'] },
  [VoterFileType.telemarketing]: { fields: ['hasLandline'] },
  [VoterFileType.robocall]: { fields: ['hasLandline'] },
  [VoterFileType.doorKnocking]: { groupByHousehold: true },
  [VoterFileType.directMail]: {},
}

export const buildVoterFilePeopleFilter = (
  type: VoterFileType,
  customFilters?: Pick<CustomVoterFile, 'filters'>,
): { filterInput: Partial<VoterFileFilter>; groupByHousehold: boolean } => {
  const filterInput: Partial<VoterFileFilter> = {}

  for (const filter of customFilters?.filters ?? []) {
    if (filter === 'audience_request') continue
    filterInput[CUSTOM_FILTER_TO_FIELD[filter]] = true
  }

  const override = TYPE_OVERRIDES[type]
  for (const field of override.fields ?? []) {
    filterInput[field] = true
  }

  return { filterInput, groupByHousehold: override.groupByHousehold ?? false }
}
