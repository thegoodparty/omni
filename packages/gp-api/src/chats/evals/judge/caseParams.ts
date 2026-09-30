import type { JsonValue } from './record'

// Placeholder substitution for a background case's params.
//
// A background agent's `input_schema` names identifiers that only exist once
// a dev organization exists: `organization_slug`, `race_id`, `user_email`.
// Those cannot be written into a case list, because the mechanism that
// produces such an organization — POST /v1/test-fixtures/users — is swept by
// `UsersService.deleteTestUsers` after about 24 hours. A hardcoded slug is
// therefore correct for one day and then dispatches every later sweep against
// an organization that no longer exists, which arrives as an agent failure
// rather than as a stale fixture.
//
// So a case list carries a token and a sweep carries the value. The fixture is
// minted once per sweep (see sweepFixture.ts), its identifiers are threaded to
// both arms through the environment exactly as JUDGE_DATA_VERSION is, and the
// tokens are replaced here, at dispatch time.

// Named one by one rather than matched by pattern, because this list is the
// vocabulary: a token nobody declared here must be a typo, and the guard below
// has to be able to tell those apart from the ones a sweep forgot to supply.
// The list is the declaration and the record is derived from it, so an
// iteration order is a value here rather than something read back out of
// Object.keys — which would need a type assertion to be a PlaceholderName.
export const PLACEHOLDER_NAMES = ['orgSlug', 'raceId', 'userEmail'] as const

export type PlaceholderName = (typeof PLACEHOLDER_NAMES)[number]

export const JUDGE_PLACEHOLDERS: Record<PlaceholderName, string> = {
  orgSlug: '{judgeOrgSlug}',
  raceId: '{judgeRaceId}',
  userEmail: '{judgeUserEmail}',
}

// Partial: a sweep that needs only an org slug has no reason to mint a race,
// and a value that is absent must fail at the guard naming what is missing
// rather than be substituted with something invented here.
export type PlaceholderValues = Partial<Record<PlaceholderName, string>>

// Every `{judge…}` token, declared or not. Substitution only ever touches the
// three above, so this is what lets a misspelled `{judgeOrgslug}` fail with a
// sentence instead of reaching the dispatch Lambda as a literal.
const PLACEHOLDER_TOKEN = /\{judge[A-Za-z0-9_]*\}/g

const substituteString = (value: string, values: PlaceholderValues): string =>
  PLACEHOLDER_NAMES.reduce((text, name) => {
    const replacement = values[name]
    return replacement === undefined
      ? text
      : text.replaceAll(JUDGE_PLACEHOLDERS[name], replacement)
  }, value)

const substituteValue = (
  value: JsonValue,
  values: PlaceholderValues,
): JsonValue => {
  if (typeof value === 'string') return substituteString(value, values)
  if (Array.isArray(value)) {
    return value.map((item) => substituteValue(item, values))
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        substituteValue(item, values),
      ]),
    )
  }
  return value
}

// Recurses, because a token is not always a whole param: the two research
// agents match `user_email` against `campaign_strategy_context.candidates[]`
// to find the candidate's own row, so the same value has to land in a nested
// array element or `is_user` never matches.
//
// Pure, and deliberately silent about a value it was not given: the sweep-wide
// check below is the one place that decides a missing value is fatal, so that
// decision happens once, over every case, before the first dispatch.
export const substituteCaseParams = (
  params: Record<string, JsonValue>,
  values: PlaceholderValues,
): Record<string, JsonValue> =>
  Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      substituteValue(value, values),
    ]),
  )

export class UnsubstitutedPlaceholderError extends Error {}

interface Finding {
  path: string
  token: string
}

const tokensIn = (text: string): string[] => text.match(PLACEHOLDER_TOKEN) ?? []

// Keys are scanned as well as values. Nothing substitutes a key — rewriting
// one could collide with a key already there — so a token in a key is always a
// mistake, and it has to be a loud one rather than a param the Lambda rejects.
const findPlaceholders = (
  value: JsonValue,
  path: string,
  found: Finding[],
): void => {
  if (typeof value === 'string') {
    for (const token of tokensIn(value)) found.push({ path, token })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      findPlaceholders(item, `${path}[${index}]`, found),
    )
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const child = path === '' ? key : `${path}.${key}`
      for (const token of tokensIn(key)) found.push({ path: child, token })
      findPlaceholders(item, child, found)
    }
  }
}

const describe = (found: readonly Finding[]): string =>
  found.map((one) => `${one.path} carries ${one.token}`).join('; ')

const advise = (found: readonly Finding[]): string => {
  const unknown = found
    .map((one) => one.token)
    .filter(
      (token) =>
        !PLACEHOLDER_NAMES.some((name) => JUDGE_PLACEHOLDERS[name] === token),
    )
  return unknown.length > 0
    ? `${[...new Set(unknown)].join(', ')} is not a placeholder this build ` +
        `knows; the vocabulary is ${Object.values(JUDGE_PLACEHOLDERS).join(', ')}`
    : 'the sweep was not given a value for it — the fixture identifiers ' +
        'reach an arm through the environment, so check that the plan step ' +
        'minted a fixture and exported it'
}

// The pre-dispatch guard. A background sweep costs roughly $13 and the
// dispatch Lambda enforces `additionalProperties: false` on a params object
// it has already accepted the message for, so a literal `{judgeOrgSlug}`
// would be refused per case after the sweep had committed to running — and
// arrive as a poll timeout with no explanation. Refusing here instead costs
// nothing.
export const assertNoPlaceholders = (
  caseId: string,
  params: Record<string, JsonValue>,
): void => {
  const found: Finding[] = []
  findPlaceholders(params, '', found)
  if (found.length === 0) return
  throw new UnsubstitutedPlaceholderError(
    `case ${caseId} would be dispatched with an unsubstituted placeholder: ` +
      `${describe(found)}. ${advise(found)}`,
  )
}

export interface SubstitutableCase {
  caseId: string
  params: Record<string, JsonValue>
}

// Substitutes a whole list and checks ALL of it before returning any of it.
// Per-case checking would let a sweep dispatch, poll and pay for cases 1-7
// and then die on case 8, so the sweep's own list is what the guard runs over
// rather than the case about to be sent.
export const substituteBackgroundCases = <T extends SubstitutableCase>(
  cases: readonly T[],
  values: PlaceholderValues,
): T[] => {
  const substituted = cases.map((one) => ({
    ...one,
    params: substituteCaseParams(one.params, values),
  }))
  for (const one of substituted) assertNoPlaceholders(one.caseId, one.params)
  return substituted
}
