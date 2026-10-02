import type { BackgroundCase } from './cases'
import type { JsonValue } from './record'

// Placeholder substitution for a background case's params.
//
// A background agent's `input_schema` names three identifiers a case list
// cannot carry: `organization_slug`, `race_id`, `user_email`. The slug is
// derived from the sweep, the race id is read live from BallotReady's data,
// and a public case list should carry no address.
//
// So a case list carries a token and a sweep carries the value. The values
// are resolved once per sweep (see judgeIdentifiers.ts), threaded to both arms
// through the environment exactly as JUDGE_DATA_VERSION is, and the tokens
// are replaced here, at dispatch time.

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

// Which environment variable supplies which token. Part of the vocabulary
// rather than of the values, because both ends of the thread name it: the
// export is built from it (`fixtureEnv` in sweepFixture.ts), and
// `ArmEnvSchema` declares the same keys from it (sweepEnv.ts), which is what
// makes an arm unable to read a variable nobody exports.
export const JUDGE_FIXTURE_ENV_NAMES = {
  orgSlug: 'JUDGE_FIXTURE_ORG_SLUG',
  raceId: 'JUDGE_FIXTURE_RACE_ID',
  userEmail: 'JUDGE_FIXTURE_USER_EMAIL',
} as const satisfies Record<PlaceholderName, string>

// Partial: a sweep that could not resolve a race still has its org slug, and
// a value that is absent must fail at the guard naming what is missing rather
// than be substituted with something invented here.
export type PlaceholderValues = Partial<Record<PlaceholderName, string>>

// Every `{judge…}` token, declared or not. Substitution only ever touches the
// three above, so this is what lets a misspelled `{judgeOrgslug}` fail with a
// sentence instead of reaching the dispatch Lambda as a literal.
// DELIBERATELY WIDER THAN THE VOCABULARY, in both case and spacing. A guard
// anchored on a lowercase `judge` matches neither `{JudgeOrgSlug}` — the
// likeliest camelCase slip there is — nor `{JUDGE_ORG_SLUG}`, and nothing else
// would catch them either, because substitution touches only the three exact
// literals. Such a typo would sail through as fourteen valid characters and
// bill two arms. `{ judgeOrgSlug }` is the same hole.
//
// Case-insensitive rather than a `[Jj]` class, so the whole word is covered
// and not just its first letter. Widening costs nothing here: these are
// authored JSON params, not prose.
const PLACEHOLDER_TOKEN = /\{\s*judge[A-Za-z0-9_]*\s*\}/gi

// Reversed once, so substitution is a lookup rather than one pass per name.
const NAME_BY_TOKEN: Record<string, PlaceholderName> = Object.fromEntries(
  PLACEHOLDER_NAMES.map((name) => [JUDGE_PLACEHOLDERS[name], name]),
)

// ONE PASS, which is a correctness property rather than a micro-optimisation.
// Three sequential `replaceAll`s each scan the PREVIOUS pass's output, so a
// fixture value that happened to contain another token's text would be
// substituted into — and a fixture value carrying any `{judge…}`-shaped
// substring would make the guard below refuse a sweep that was in fact
// complete. Replacing through the matcher touches only the original bytes.
//
// A token this build does not know, and a token whose value the sweep did not
// supply, are both left exactly as they were. Deciding that either is fatal is
// the guard's job, once, over the whole list.
const substituteString = (value: string, values: PlaceholderValues): string =>
  value.replace(PLACEHOLDER_TOKEN, (token) => {
    const name = NAME_BY_TOKEN[token]
    return name === undefined ? token : (values[name] ?? token)
  })

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
    : 'the sweep was not given a value for it — the identifiers reach an ' +
        "arm through the environment, so check the 'Resolve the background " +
        "agents' identifiers' step"
}

// The pre-dispatch guard, and NOTHING DOWNSTREAM OF IT WOULD CATCH THIS.
// That was worth checking rather than assuming, because it decides whether
// this function is a convenience or the only thing standing between a typo
// and a paid run:
//
//   - A token in a VALUE is accepted everywhere. Every one of these params is
//     a plain string with at most `minLength: 1` — no pattern, no format — and
//     `{judgeOrgSlug}` is fourteen characters, so the manifest passes it, the
//     message is accepted, a Fargate task launches, and the agent runs against
//     an organization that does not exist. A roughly $13 background sweep is
//     then spent on an artifact that is an error or an invention, on BOTH arms,
//     and the verdict looks like a real comparison.
//   - A token in a KEY is refused, but only by fourteen of the sixteen
//     manifests: `opportunities_and_challenges` and `opposition_research` set
//     `additionalProperties: true`, so there a stray key is silently dropped
//     instead.
//
// So there is no schema below this line that turns a missing fixture value
// into a cheap failure. Refusing here does, and costs nothing.
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

// The loader's own shape, narrowed to the two fields substitution touches, so
// this is not a third declaration of "a background case". `Pick` rather than
// the whole type, because the runner's case carries `inputFiles` too and the
// generic below has to accept both.
export type SubstitutableCase = Pick<BackgroundCase, 'caseId' | 'params'>

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
