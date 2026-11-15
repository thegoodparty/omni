import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ContactUploadMatchMethod } from '@/generated/prisma'
import type {
  ContactUploadMatchCandidateRow,
  FirstNameMatch,
} from '@/peopleDb/databricks/contactUploadMatchSql.util'

// Must agree with the warehouse side in contactUploadMatchSql.util.ts:
// lowercased, letters only.
export const nameKey = (value: string | null): string =>
  (value ?? '').toLowerCase().replace(/[^a-z]/g, '')

// data/nicknames.csv, from github.com/carltonnorthern/nicknames (Apache 2.0,
// data/nicknames.LICENSE.txt): rows of `name1,has_nickname,name2`.
const nicknamesOf = new Map<string, Set<string>>()
const canonicalsOf = new Map<string, Set<string>>()
for (const line of readFileSync(
  path.join(__dirname, '..', 'data', 'nicknames.csv'),
  'utf8',
)
  .split('\n')
  .slice(1)) {
  const [canonicalName, , nicknameName] = line.split(',')
  const canonical = nameKey(canonicalName ?? null)
  const nickname = nameKey(nicknameName ?? null)
  if (!canonical || !nickname) continue
  nicknamesOf.set(
    canonical,
    (nicknamesOf.get(canonical) ?? new Set()).add(nickname),
  )
  canonicalsOf.set(
    nickname,
    (canonicalsOf.get(nickname) ?? new Set()).add(canonical),
  )
}

// The first name, its nicknames and the names it is a nickname of. Never a
// nickname's other full names' nicknames: that walk links "bob" to "bill"
// and "ron" to "erin".
export const firstNameAliases = (firstKey: string): string[] =>
  [
    ...new Set([
      firstKey,
      ...(nicknamesOf.get(firstKey) ?? []),
      ...(canonicalsOf.get(firstKey) ?? []),
    ]),
  ].sort()

export const FIRST_NAME_MATCH_POINTS: Record<FirstNameMatch, number> = {
  exact: 30,
  alias: 20,
  prefix: 15,
  typo: 5,
}
export const PHONE_AGREES_POINTS = 20
export const ADDRESS_AGREES_POINTS = 20

// buildContactUploadMatchSql ranks a row's candidates by the same sum, so
// the top MAX_CANDIDATES_PER_ROW it returns are the strongest.
export const candidateScore = (
  candidate: ContactUploadMatchCandidateRow,
): number =>
  FIRST_NAME_MATCH_POINTS[candidate.firstNameMatch] +
  (candidate.phoneAgrees ? PHONE_AGREES_POINTS : 0) +
  (candidate.addressAgrees ? ADDRESS_AGREES_POINTS : 0)

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
  firstNameMatch: FirstNameMatch | null
  personId: string | null
  isNewPerson: boolean
  candidatePersonIds: string[]
  suggestedPersonId: string | null
}

// A candidate is auto-matched only when its first name is closer than a
// typo, its phone or address agrees, and it outscores every other candidate.
// Returns null when nobody in the district is a candidate: a new person.
export const decideFromCandidates = (
  candidates: ContactUploadMatchCandidateRow[],
): MatchDecision | null => {
  const ranked = candidates
    .map((candidate) => ({ candidate, score: candidateScore(candidate) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.candidate.personId < b.candidate.personId ? -1 : 1),
    )
  const [top, runnerUp] = ranked
  if (!top) return null
  if (
    top.candidate.firstNameMatch !== 'typo' &&
    (top.candidate.phoneAgrees || top.candidate.addressAgrees) &&
    (!runnerUp || top.score > runnerUp.score)
  ) {
    return {
      outcome: 'matched',
      method: top.candidate.phoneAgrees
        ? ContactUploadMatchMethod.name_and_phone
        : ContactUploadMatchMethod.name_and_address,
      firstNameMatch: top.candidate.firstNameMatch,
      personId: top.candidate.personId,
      isNewPerson: false,
      candidatePersonIds: [],
      suggestedPersonId: null,
    }
  }
  return {
    outcome: 'needs_input',
    method: null,
    firstNameMatch: null,
    personId: null,
    isNewPerson: false,
    candidatePersonIds: ranked.map(({ candidate }) => candidate.personId),
    suggestedPersonId:
      top.candidate.candidateCount === 1 &&
      top.candidate.firstNameMatch === 'exact'
        ? top.candidate.personId
        : null,
  }
}
