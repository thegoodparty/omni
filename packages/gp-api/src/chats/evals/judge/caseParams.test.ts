import { describe, expect, it } from 'vitest'
import {
  assertNoPlaceholders,
  JUDGE_PLACEHOLDERS,
  substituteBackgroundCases,
  substituteCaseParams,
  UnsubstitutedPlaceholderError,
} from './caseParams'
import type { JsonValue } from './record'

const VALUES = {
  orgSlug: 'eo-0192e4a0-1f00-7000-8000-0000000c0de1',
  raceId: 'gAAAAABkRaCeIdFromBallotReady',
  userEmail: 'qa-6f1c9d84-3b52-4a27-9e0f-7c3d51ab2049@goodparty.org',
}

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

  it('leaves a token whose value the sweep did not supply', () => {
    expect(
      substituteCaseParams(
        { race_id: JUDGE_PLACEHOLDERS.raceId },
        { orgSlug: VALUES.orgSlug },
      ),
    ).toEqual({ race_id: JUDGE_PLACEHOLDERS.raceId })
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
    ).toThrow(/minted a fixture and exported it/)
  })

  // A misspelling is never substituted, so it would otherwise reach the
  // Lambda as a literal. It needs a different sentence from a value the
  // sweep forgot, because the fix is in the file rather than in the sweep.
  it('calls out a token that is not in the vocabulary', () => {
    expect(() =>
      assertNoPlaceholders('typo', { organization_slug: '{judgeOrgslug}' }),
    ).toThrow(/\{judgeOrgslug\} is not a placeholder this build knows/)
  })

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

  // Both arms are separate processes in separate worktrees, so the only thing
  // that makes their params identical is being handed the same values. A
  // different org per arm would make every verdict an artifact of the fixture.
  it('gives both arms identical params from one set of values', () => {
    const base = substituteBackgroundCases(CASES, VALUES)
    const candidate = substituteBackgroundCases(CASES, VALUES)
    expect(JSON.stringify(candidate)).toBe(JSON.stringify(base))
  })
})
