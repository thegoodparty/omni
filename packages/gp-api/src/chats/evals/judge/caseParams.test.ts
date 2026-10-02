import { describe, expect, it } from 'vitest'
import {
  assertNoPlaceholders,
  JUDGE_PLACEHOLDERS,
  missingValues,
  substituteBackgroundCases,
  substituteCaseParams,
  UnsubstitutedPlaceholderError,
} from './caseParams'
import { SWEEP_VALUES as VALUES } from './fixtures/sweep'
import type { JsonValue } from './record'

describe('substituteCaseParams', () => {
  it('replaces a top-level token', () => {
    expect(
      substituteCaseParams(
        { organization_slug: JUDGE_PLACEHOLDERS.orgSlug, state: 'MN' },
        VALUES,
      ),
    ).toEqual({ organization_slug: VALUES.orgSlug, state: 'MN' })
  })

  // The two research agents match user_email against
  // campaign_strategy_context.candidates[].email to find the candidate's own
  // row, so a substitution that only rewrote top-level params would leave
  // is_user unmatchable.
  it('replaces a token nested inside an array of objects', () => {
    const params: Record<string, JsonValue> = {
      user_email: JUDGE_PLACEHOLDERS.userEmail,
      campaign_strategy_context: {
        candidates: [
          { full_name: 'Test Candidate', email: JUDGE_PLACEHOLDERS.userEmail },
          { full_name: 'Test Incumbent', email: null },
        ],
      },
    }
    expect(substituteCaseParams(params, VALUES)).toEqual({
      user_email: VALUES.userEmail,
      campaign_strategy_context: {
        candidates: [
          { full_name: 'Test Candidate', email: VALUES.userEmail },
          { full_name: 'Test Incumbent', email: null },
        ],
      },
    })
  })

  it('leaves numbers, booleans and nulls alone', () => {
    const params: Record<string, JsonValue> = {
      candidate_count: 3,
      is_incumbent: false,
      election_date: null,
    }
    expect(substituteCaseParams(params, VALUES)).toEqual(params)
  })

  // ONE PASS, not one pass per name. Three sequential replaceAll passes each
  // scan the PREVIOUS pass's output, so a value that happened to contain
  // another token's text would be substituted into a second time. Real
  // identifiers never look like tokens, which is exactly why this has to be a
  // test rather than an observation.
  //
  // `assertNoPlaceholders` would still refuse the result, deliberately: it
  // judges the bytes that are about to be dispatched and cannot know one of
  // them came from a fixture. So the property belongs to substitution, and is
  // asserted on substitution.
  it('does not substitute into a value it just substituted', () => {
    expect(
      substituteCaseParams(
        { organization_slug: JUDGE_PLACEHOLDERS.orgSlug },
        { orgSlug: JUDGE_PLACEHOLDERS.raceId, raceId: VALUES.raceId },
      ),
    ).toEqual({ organization_slug: JUDGE_PLACEHOLDERS.raceId })
  })

  it('leaves a token whose value the sweep did not supply', () => {
    expect(
      substituteCaseParams(
        { race_id: JUDGE_PLACEHOLDERS.raceId },
        { orgSlug: VALUES.orgSlug },
      ),
    ).toEqual({ race_id: JUDGE_PLACEHOLDERS.raceId })
  })
})

// Pure in, pure out. A sweep loads one case list and substitutes it once per
// arm, so an in-place edit would make the second arm's params depend on the
// first's having run.
describe('substituteCaseParams immutability', () => {
  it('does not mutate the params it was given', () => {
    const params: Record<string, JsonValue> = {
      organization_slug: JUDGE_PLACEHOLDERS.orgSlug,
      campaign_strategy_context: {
        candidates: [{ email: JUDGE_PLACEHOLDERS.userEmail }],
      },
    }
    const before = JSON.stringify(params)
    substituteCaseParams(params, VALUES)
    expect(JSON.stringify(params)).toBe(before)
  })

  it('does not mutate the cases it was given', () => {
    const cases = [
      { caseId: 'first', params: { organization_slug: '{judgeOrgSlug}' } },
    ]
    const before = JSON.stringify(cases)
    substituteBackgroundCases(cases, VALUES)
    expect(JSON.stringify(cases)).toBe(before)
  })
})

describe('assertNoPlaceholders', () => {
  it('passes a fully substituted params object', () => {
    expect(() =>
      assertNoPlaceholders('baseline', {
        organization_slug: VALUES.orgSlug,
        state: 'MN',
      }),
    ).not.toThrow()
  })

  it('names the case, the path and the token', () => {
    expect(() =>
      assertNoPlaceholders('baseline', {
        organization_slug: JUDGE_PLACEHOLDERS.orgSlug,
      }),
    ).toThrow(/case baseline .*organization_slug carries \{judgeOrgSlug\}/)
  })

  it('says which variable was meant to supply a known token', () => {
    expect(() =>
      assertNoPlaceholders('baseline', { race_id: JUDGE_PLACEHOLDERS.raceId }),
    ).toThrow(/Resolve the background agents' identifiers/)
  })

  // A misspelling is never substituted, so it would otherwise reach the
  // Lambda as a literal. It needs a different sentence from a value the
  // sweep forgot, because the fix is in the file rather than in the sweep.
  // Never substituted, so it would otherwise reach the Lambda as a literal.
  // It needs a different sentence from a value the sweep forgot, because the
  // fix is in the file rather than in the sweep.
  //
  // `{JudgeOrgSlug}` is the case that matters most and the one a lowercase-
  // anchored matcher missed: it is the likeliest camelCase slip, and nothing
  // downstream refuses fourteen valid characters.
  it.each([
    '{judgeOrgslug}',
    '{JudgeOrgSlug}',
    '{JUDGE_ORG_SLUG}',
    '{ judgeOrgSlug }',
  ])('calls out %s, which is not in the vocabulary', (token) => {
    expect(() =>
      assertNoPlaceholders('typo', { organization_slug: token }),
    ).toThrow(/is not a placeholder this build knows/)
  })

  // The other half of that widening: a near-miss must not be substituted
  // either, or it would be silently repaired into a value nobody authored.
  it.each(['{JudgeOrgSlug}', '{ judgeOrgSlug }'])(
    'leaves %s alone rather than substituting it',
    (token) => {
      expect(
        substituteCaseParams({ organization_slug: token }, VALUES),
      ).toEqual({ organization_slug: token })
    },
  )

  it('finds a token nested in an array', () => {
    expect(() =>
      assertNoPlaceholders('nested', {
        campaign_strategy_context: {
          candidates: [{ email: JUDGE_PLACEHOLDERS.userEmail }],
        },
      }),
    ).toThrow(
      /campaign_strategy_context\.candidates\[0\]\.email carries \{judgeUserEmail\}/,
    )
  })

  // Nothing substitutes a key, so a token in one is always a mistake.
  it('finds a token in an object key', () => {
    expect(() =>
      assertNoPlaceholders('keyed', { '{judgeOrgSlug}': 'value' }),
    ).toThrow(UnsubstitutedPlaceholderError)
  })
})

describe('substituteBackgroundCases', () => {
  const CASES = [
    { caseId: 'first', params: { organization_slug: '{judgeOrgSlug}' } },
    { caseId: 'second', params: { organization_slug: '{judgeOrgSlug}' } },
  ]

  it('substitutes every case', () => {
    expect(substituteBackgroundCases(CASES, VALUES)).toEqual([
      { caseId: 'first', params: { organization_slug: VALUES.orgSlug } },
      { caseId: 'second', params: { organization_slug: VALUES.orgSlug } },
    ])
  })

  it('keeps fields other than params', () => {
    expect(
      substituteBackgroundCases(
        [{ caseId: 'first', params: {}, inputFiles: [] }],
        VALUES,
      )[0],
    ).toEqual({ caseId: 'first', params: {}, inputFiles: [] })
  })

  // The property that makes the guard worth having: the whole list is checked
  // before any of it is returned, so nothing is dispatched or paid for ahead
  // of the case that is missing a value.
  it('refuses the whole list when any one case is unsubstituted', () => {
    expect(() =>
      substituteBackgroundCases(CASES, { raceId: VALUES.raceId }),
    ).toThrow(UnsubstitutedPlaceholderError)
  })

  it('refuses before returning a case that would have been fine', () => {
    expect(() =>
      substituteBackgroundCases(
        [
          { caseId: 'fine', params: { state: 'MN' } },
          { caseId: 'broken', params: { race_id: '{judgeRaceId}' } },
        ],
        { orgSlug: VALUES.orgSlug },
      ),
    ).toThrow(/case broken/)
  })
})

describe('missingValues', () => {
  const cases: { params: Record<string, JsonValue> }[] = [
    { params: { race_id: '{judgeRaceId}', nested: ['{judgeUserEmail}'] } },
    { params: { organization_slug: '{judgeOrgSlug}', typo: '{judgeTypo}' } },
  ]

  it('names each known token the sweep has no value for', () => {
    expect(missingValues(cases, { orgSlug: 'judge-1-1' })).toEqual([
      'raceId',
      'userEmail',
    ])
  })

  it('names none when every used value is supplied', () => {
    expect(missingValues(cases, VALUES)).toEqual([])
  })

  // An unknown token is a broken list, which this must not excuse.
  it('never names a token outside the vocabulary', () => {
    expect(missingValues([{ params: { x: '{judgeTypo}' } }], {})).toEqual([])
  })
})
