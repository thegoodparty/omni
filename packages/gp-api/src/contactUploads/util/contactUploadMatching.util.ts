import { ContactUploadMatchMethod } from '@/generated/prisma'
import type { ContactUploadMatchCandidateRow } from '@/peopleDb/databricks/contactUploadMatchSql.util'

// Must agree with the warehouse side in contactUploadMatchSql.util.ts:
// lowercased, letters only.
export const nameKey = (value: string | null): string =>
  (value ?? '').toLowerCase().replace(/[^a-z]/g, '')

const STREET_DIRECTIONS = new Set([
  'n',
  's',
  'e',
  'w',
  'ne',
  'nw',
  'se',
  'sw',
  'north',
  'south',
  'east',
  'west',
])

// "123 N Oak St Apt 4" -> { house: '123', streetKey: 'oak' }. The first
// street token only, so "Oak St" and "Oak Street" agree; a leading direction
// is skipped because L2 keeps it out of Residence_Addresses_StreetName.
export const addressParts = (
  addressLine: string | null,
): { house: string | null; streetKey: string | null } => {
  const match = /^\s*(\d+)\S*\s+(.*)$/.exec(addressLine ?? '')
  if (!match?.[1] || match[2] === undefined) {
    return { house: null, streetKey: null }
  }
  const tokens = match[2]
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
  const [first, second] = tokens
  const streetKey =
    first !== undefined && STREET_DIRECTIONS.has(first) && second
      ? second
      : (first ?? null)
  return { house: match[1], streetKey }
}

export type MatchDecision = {
  outcome: 'matched' | 'new' | 'needs_input'
  method: ContactUploadMatchMethod | null
  personId: string | null
  isNewPerson: boolean
  candidatePersonIds: string[]
  suggestedPersonId: string | null
}

// The outcome table in the Import contacts implementation notes, section 3.
// Returns null when nobody in the district shares the name: a new person.
export const decideFromCandidates = (
  candidates: ContactUploadMatchCandidateRow[],
): MatchDecision | null => {
  const [first] = candidates
  if (!first) return null
  const agreeing = candidates.filter(
    (candidate) => candidate.phoneAgrees || candidate.addressAgrees,
  )
  const [onlyAgreeing] = agreeing
  if (agreeing.length === 1 && onlyAgreeing) {
    return {
      outcome: 'matched',
      method: onlyAgreeing.phoneAgrees
        ? ContactUploadMatchMethod.name_and_phone
        : ContactUploadMatchMethod.name_and_address,
      personId: onlyAgreeing.personId,
      isNewPerson: false,
      candidatePersonIds: [],
      suggestedPersonId: null,
    }
  }
  if (agreeing.length > 1) {
    return {
      outcome: 'needs_input',
      method: null,
      personId: null,
      isNewPerson: false,
      candidatePersonIds: agreeing.map((candidate) => candidate.personId),
      suggestedPersonId: null,
    }
  }
  return {
    outcome: 'needs_input',
    method: null,
    personId: null,
    isNewPerson: false,
    candidatePersonIds: candidates.map((candidate) => candidate.personId),
    suggestedPersonId: first.nameCount === 1 ? first.personId : null,
  }
}
