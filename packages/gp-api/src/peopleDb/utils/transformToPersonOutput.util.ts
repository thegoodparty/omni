import type { Person } from '@goodparty_org/contracts'
import { BaseDbPerson } from '../voter.select'
import { classifyPoliticalParty } from './politicalParty.rules'

// people-api is the producer of this shape; the canonical definition lives in
// @goodparty_org/contracts as Person (consumed by gp-api and gp-webapp).
export type PersonOutputFormat = Person

export const mapAge = (
  person: Pick<BaseDbPerson, 'Age' | 'Age_Int'>,
): PersonOutputFormat['age'] => {
  if (typeof person.Age_Int === 'number' && Number.isFinite(person.Age_Int))
    return person.Age_Int
  if (person.Age && Number.isFinite(parseInt(String(person.Age), 10)))
    return parseInt(String(person.Age), 10)
  return null
}

const mapGender = (
  value: string | null | undefined,
): PersonOutputFormat['gender'] => {
  if (!value) return null
  if (value === 'M') return 'Male'
  if (value === 'F') return 'Female'
  return null
}

const mapMaritalStatus = (
  value: string | null | undefined,
): PersonOutputFormat['maritalStatus'] => {
  if (!value) return null
  const v = value.toLowerCase()
  if (v.includes('inferred married')) return 'Likely Married'
  if (v.includes('inferred single')) return 'Likely Single'
  if (v === 'married') return 'Married'
  if (v === 'single') return 'Single'
  return null
}

const mapPresenceOfChildren = (
  value: string | null | undefined,
): PersonOutputFormat['hasChildrenUnder18'] => {
  if (!value) return null
  const v = value.toLowerCase()
  if (v === 'y' || v === 'yes') return 'Yes'
  if (v === 'n' || v === 'no') return 'No'
  return null
}

const mapHomeowner = (
  value: string | null | undefined,
): PersonOutputFormat['homeowner'] => {
  if (!value) return null
  const v = value.toLowerCase()
  if (v === 'home owner') return 'Yes'
  if (v === 'probable home owner') return 'Likely'
  if (v === 'renter') return 'No'
  return null
}

const mapEducation = (
  value: string | null | undefined,
): PersonOutputFormat['levelOfEducation'] => {
  if (!value) return null
  const v = value.toLowerCase()
  if (v === 'did not complete high school likely') return 'None'
  if (v === 'completed high school likely') return 'High School Diploma'
  if (v === 'attended vocational/technical school likely')
    return 'Technical School'
  if (v === 'attended but did not complete college likely')
    return 'Some College'
  if (v === 'completed college likely') return 'College Degree'
  if (v === 'completed graduate school likely') return 'Graduate Degree'
  return null
}

const mapEthnicity = (
  value: string | null | undefined,
): PersonOutputFormat['ethnicityGroup'] => {
  if (!value) return null
  const v = value.toLowerCase()
  if (v === 'east and south asian') return 'Asian'
  if (v === 'european') return 'European'
  if (v === 'hispanic and portuguese') return 'Hispanic'
  if (v === 'likely african-american') return 'African American'
  if (v === 'other') return 'Other'
  return null
}

const mapBusinessOwner = (
  value: string | null | undefined,
): PersonOutputFormat['businessOwner'] => {
  if (!value) return null
  return 'Yes'
}

const mapVeteranStatus = (
  value: string | null | undefined,
): PersonOutputFormat['veteranStatus'] => {
  if (!value) return null
  if (value === 'Yes') return 'Yes'
  return null
}

// Exact-value classification. The value sets live in ./politicalParty.rules so
// the SQL filter (filters.sql.util.ts) selects exactly the rows that classify
// here — see that file for the reconciled filter.
export const mapPoliticalParty = (
  value: string | null | undefined,
): PersonOutputFormat['politicalParty'] => classifyPoliticalParty(value)

const mapLanguage = (
  value: string | null | undefined,
): PersonOutputFormat['language'] => {
  if (!value) return 'Other'
  const v = value.toLowerCase()
  if (v === 'english') return 'English'
  if (v === 'spanish') return 'Spanish'
  return 'Other'
}

// Known voterStatus vocabulary from the contract's `voterStatus` enum. Any DB
// value outside this set (including the sentinel 'Unknown') maps to null
// rather than being cast through unchecked — the output type stays honest.
const VOTER_STATUS_VALUES = [
  'Super',
  'Likely',
  'Unreliable',
  'Unlikely',
  'First Time',
] as const satisfies ReadonlyArray<
  NonNullable<PersonOutputFormat['voterStatus']>
>

const VOTER_STATUS_SET: ReadonlySet<string> = new Set(VOTER_STATUS_VALUES)

const isVoterStatus = (
  value: string,
): value is NonNullable<PersonOutputFormat['voterStatus']> =>
  VOTER_STATUS_SET.has(value)

export const mapVoterStatus = (
  value: string | null | undefined,
): PersonOutputFormat['voterStatus'] => {
  if (!value || !isVoterStatus(value)) return null
  return value
}

export function transformToPersonOutput(
  person: BaseDbPerson,
): PersonOutputFormat {
  return {
    id: person.id,
    lalVoterId: person.LALVOTERID,
    firstName: person.FirstName ?? null,
    middleName: person.MiddleName ?? null,
    lastName: person.LastName ?? null,
    nameSuffix: person.NameSuffix ?? null,
    gender: mapGender(person.Gender),
    age: mapAge(person),
    politicalParty: mapPoliticalParty(person.Parties_Description),
    voterStatus: mapVoterStatus(person.Voter_Status),
    registeredVoter: 'Yes',
    state: person.State,
    address: {
      line1: person.Residence_Addresses_AddressLine,
      line2: person.Residence_Addresses_ExtraAddressLine,
      city: person.Residence_Addresses_City,
      state: person.Residence_Addresses_State,
      zip: person.Residence_Addresses_Zip,
      zipPlus4: person.Residence_Addresses_ZipPlus4,
      latitude: person.Residence_Addresses_Latitude,
      longitude: person.Residence_Addresses_Longitude,
    },
    cellPhone: person.VoterTelephones_CellPhoneFormatted ?? null,
    landline: person.VoterTelephones_LandlineFormatted ?? null,
    maritalStatus: mapMaritalStatus(person.Marital_Status),
    hasChildrenUnder18: mapPresenceOfChildren(person.Presence_Of_Children),
    veteranStatus: mapVeteranStatus(person.Veteran_Status),
    homeowner: mapHomeowner(person.Homeowner_Probability_Model),
    businessOwner: mapBusinessOwner(person.Business_Owner),
    levelOfEducation: mapEducation(person.Education_Of_Person),
    ethnicityGroup: mapEthnicity(person.EthnicGroups_EthnicGroup1Desc),
    language: mapLanguage(person.Language_Code),
    estimatedIncomeAmount: person.Estimated_Income_Amount_Int,
    householdId: person.householdId ?? null,
    householdSize:
      person.householdSize == null ? null : Number(person.householdSize),
  }
}
