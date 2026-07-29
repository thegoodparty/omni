import { Prisma, Voter } from '../generated/prisma'

const VOTER_SELECT_COLUMNS = [
  'id',
  'LALVOTERID',
  'State',
  'FirstName',
  'MiddleName',
  'LastName',
  'NameSuffix',
  'Residence_Addresses_AddressLine',
  'Residence_Addresses_ExtraAddressLine',
  'Residence_Addresses_City',
  'Residence_Addresses_State',
  'Residence_Addresses_Zip',
  'Residence_Addresses_ZipPlus4',
  'Mailing_Addresses_AddressLine',
  'Mailing_Addresses_ExtraAddressLine',
  'Mailing_Addresses_City',
  'Mailing_Addresses_State',
  'Mailing_Addresses_Zip',
  'Mailing_Addresses_ZipPlus4',
  'Residence_Addresses_Latitude',
  'Residence_Addresses_Longitude',
  'VoterTelephones_LandlineFormatted',
  'VoterTelephones_CellPhoneFormatted',
  'Age',
  'Gender',
  'Parties_Description',
  'Business_Owner',
  'Education_Of_Person',
  'Estimated_Income_Amount_Int',
  'Homeowner_Probability_Model',
  'Language_Code',
  'Marital_Status',
  'Presence_Of_Children',
  'Veteran_Status',
  'Voter_Status',
  'EthnicGroups_EthnicGroup1Desc',
  'Age_Int',
  'VotingPerformanceEvenYearGeneral',
  'VotingPerformanceMinorElection',
] as const satisfies (keyof Voter)[]

export type BaseSelectedField = (typeof VOTER_SELECT_COLUMNS)[number]

export type ExtraSelectedField = Exclude<keyof Voter, BaseSelectedField>

export function buildVoterSelectSql(
  extraFields: ExtraSelectedField[] = [],
  computedColumns: Prisma.Sql[] = [],
  distinctClause: Prisma.Sql = Prisma.empty,
) {
  const columnNames = Array.from(
    new Set([...VOTER_SELECT_COLUMNS, ...extraFields]),
  )
  const quoteIdent = (id: string) => `"${id.replace(/"/g, '""')}"`
  const cols: Prisma.Sql[] = columnNames.map((f) => {
    return Prisma.sql`${Prisma.raw(`v.${quoteIdent(f)} AS ${quoteIdent(f)}`)}`
  })
  cols.push(...computedColumns)

  return {
    columnNames,
    sql: Prisma.sql`SELECT ${distinctClause}${Prisma.join(cols, ', ')}`,
  }
}

export type BaseDbPerson = Pick<Voter, BaseSelectedField> & {
  householdId?: string | null
  householdSize?: bigint | number | null
}

// ENG-10766: the curated ~54-column CSV subset with friendly headers, restored
// from the pre-ENG-5032 gp-api `headerMapping.const.ts` (deleted at
// eb198e327). `satisfies` (not a widening annotation) pins `column` to
// `keyof Voter` so a rename/typo fails to compile, while keeping each entry's
// literal column name available for `EXCLUDABLE_VOTER_COLUMNS` below — most
// excludable columns (turnout/vote-history) are download-only and never
// appear in `VOTER_SELECT_COLUMNS`. Order matches the legacy mapping; five
// legacy keys no longer exist on the model — `MaritalStatus_Description` is
// served via `Marital_Status`, and `Languages_Description` /
// `Mailing_Families_HHCount` / `Mailing_HHParties_Description` /
// `MilitaryStatus_Description` are dropped (no current equivalent —
// `Language_Code` is a code, not a description, so it's deliberately not
// substituted). Election history ships the four most recent General/Primary
// years instead of the legacy's hardcoded 2016-2022.
export const DOWNLOAD_COLUMNS = [
  { column: 'LALVOTERID', header: 'Voter ID' },
  { column: 'FirstName', header: 'First Name' },
  { column: 'MiddleName', header: 'Middle Name' },
  { column: 'LastName', header: 'Last Name' },
  { column: 'NameSuffix', header: 'Suffix' },
  { column: 'Parties_Description', header: 'Registered Party' },
  { column: 'Gender', header: 'Gender' },
  { column: 'Age', header: 'Age' },
  { column: 'VotingPerformanceEvenYearGeneral', header: 'Likelihood to vote' },
  {
    column: 'VotingPerformanceEvenYearPrimary',
    header: 'Primary Likelihood to Vote',
  },
  {
    column: 'VotingPerformanceEvenYearGeneralAndPrimary',
    header: 'Combined General and Primary Likelihood to Vote',
  },
  { column: 'Residence_Addresses_ApartmentType', header: 'Apartment Type' },
  { column: 'EthnicGroups_EthnicGroup1Desc', header: 'Ethnicity' },
  { column: 'Residence_Addresses_Latitude', header: 'Latitude' },
  { column: 'Residence_Addresses_Longitude', header: 'Longitude' },
  {
    column: 'Residence_HHParties_Description',
    header: 'Household Party Registration',
  },
  { column: 'SequenceOddEven', header: 'Street Number Odd/Even' },
  { column: 'VoterTelephones_CellPhoneFormatted', header: 'Cell Phone' },
  {
    column: 'VoterTelephones_CellConfidenceCode',
    header: 'Cell Phone Confidence Code',
  },
  { column: 'VoterTelephones_LandlineFormatted', header: 'Landline' },
  {
    column: 'VoterTelephones_LandlineConfidenceCode',
    header: 'Landline Confidence Code',
  },
  {
    column: 'VoterParties_Change_Changed_Party',
    header: 'Voter Changed Party?',
  },
  { column: 'Residence_Addresses_AddressLine', header: 'Address' },
  {
    column: 'Residence_Addresses_ExtraAddressLine',
    header: 'Second Address Line',
  },
  { column: 'Residence_Addresses_HouseNumber', header: 'House Number' },
  { column: 'Residence_Addresses_City', header: 'City' },
  { column: 'Residence_Addresses_State', header: 'State' },
  { column: 'Residence_Addresses_Zip', header: 'Zipcode' },
  { column: 'Residence_Addresses_ZipPlus4', header: 'Zip+4' },
  { column: 'Mailing_Addresses_AddressLine', header: 'Mailing Address' },
  {
    column: 'Mailing_Addresses_ExtraAddressLine',
    header: 'Mailing Address Extra Line',
  },
  { column: 'Mailing_Addresses_City', header: 'Mailing City' },
  { column: 'Mailing_Addresses_State', header: 'Mailing State' },
  { column: 'Mailing_Addresses_Zip', header: 'Mailing Zip' },
  { column: 'Mailing_Addresses_ZipPlus4', header: 'Mailing Zip+4' },
  { column: 'Mailing_Addresses_DPBC', header: 'Mailing Bar Code' },
  { column: 'Mailing_Addresses_CheckDigit', header: 'Mailing Verifier' },
  { column: 'Mailing_Addresses_HouseNumber', header: 'Mailing House Number' },
  {
    column: 'Mailing_Addresses_PrefixDirection',
    header: 'Mailing Address Prefix',
  },
  { column: 'Mailing_Addresses_StreetName', header: 'Mailing Street Name' },
  { column: 'Mailing_Addresses_Designator', header: 'Mailing Designator' },
  {
    column: 'Mailing_Addresses_SuffixDirection',
    header: 'Mailing Suffix Direction',
  },
  {
    column: 'Mailing_Addresses_ApartmentNum',
    header: 'Mailing Apartment Number',
  },
  {
    column: 'Mailing_Addresses_ApartmentType',
    header: 'Mailing Apartment Type',
  },
  { column: 'Marital_Status', header: 'Marital Status' },
  { column: 'Mailing_Families_FamilyID', header: 'Mailing Family ID' },
  { column: 'General_2026', header: 'Voted in 2026' },
  { column: 'General_2024', header: 'Voted in 2024' },
  { column: 'General_2022', header: 'Voted in 2022' },
  { column: 'General_2020', header: 'Voted in 2020' },
  { column: 'Primary_2026', header: 'Voted in 2026 Primary' },
  { column: 'Primary_2024', header: 'Voted in 2024 Primary' },
  { column: 'Primary_2022', header: 'Voted in 2022 Primary' },
  { column: 'Primary_2020', header: 'Voted in 2020 Primary' },
] as const satisfies ReadonlyArray<{ column: keyof Voter; header: string }>

export type DownloadColumn = (typeof DOWNLOAD_COLUMNS)[number]['column']

// Columns a caller may ask the download COPY to omit from its projection
// (ENG-10696: the Serve party-visibility rule; ENG-10830: extended to the
// remaining party fields, turnout propensity, and vote history). `satisfies`
// pins this to an actual `DOWNLOAD_COLUMNS` column so a typo can't silently
// become a no-op filter.
export const EXCLUDABLE_VOTER_COLUMNS = [
  'Parties_Description',
  'Residence_HHParties_Description',
  'VoterParties_Change_Changed_Party',
  'VotingPerformanceEvenYearGeneral',
  'VotingPerformanceEvenYearPrimary',
  'VotingPerformanceEvenYearGeneralAndPrimary',
  'General_2026',
  'General_2024',
  'General_2022',
  'General_2020',
  'Primary_2026',
  'Primary_2024',
  'Primary_2022',
  'Primary_2020',
] as const satisfies readonly DownloadColumn[]

export type ExcludableVoterColumn = (typeof EXCLUDABLE_VOTER_COLUMNS)[number]
