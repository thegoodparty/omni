import { describe, it, expect } from 'vitest'
import {
  AUDIENCE_FILTER_KEY_MAP,
  VOTER_FILE_FILTER_KEY_MAP,
  AUDIENCE_FILTER_SNAKE_KEYS,
  AUDIENCE_FILTER_CAMEL_KEYS,
  snakeToCamelAudienceKey,
  camelToSnakeAudienceKey,
  AudienceFilterSnakeKey,
  AudienceFilterCamelKey,
} from './audienceFilterKeyMap'

// Locked expectation of the canonical mapping. A change here should be a
// deliberate edit, not an accidental drift.
const EXPECTED_SNAKE_TO_CAMEL: Record<string, string> = {
  audience_superVoters: 'audienceSuperVoters',
  audience_likelyVoters: 'audienceLikelyVoters',
  audience_unreliableVoters: 'audienceUnreliableVoters',
  audience_unlikelyVoters: 'audienceUnlikelyVoters',
  audience_firstTimeVoters: 'audienceFirstTimeVoters',
  party_independent: 'partyIndependent',
  party_democrat: 'partyDemocrat',
  party_republican: 'partyRepublican',
  age_18_25: 'age18_25',
  age_25_35: 'age25_35',
  age_35_50: 'age35_50',
  age_50_plus: 'age50Plus',
  age_18_24: 'age18_24',
  age_25_34: 'age25_34',
  age_35_49: 'age35_49',
  age_50_64: 'age50_64',
  age_65_plus: 'age65Plus',
  gender_male: 'genderMale',
  gender_female: 'genderFemale',
  gender_unknown: 'genderUnknown',
}

describe('audienceFilterKeyMap', () => {
  it('exposes the canonical snake_case -> camelCase mapping', () => {
    expect(AUDIENCE_FILTER_KEY_MAP).toEqual(EXPECTED_SNAKE_TO_CAMEL)
  })

  it('derives the inverse camelCase -> snake_case mapping', () => {
    const expectedInverse = Object.fromEntries(
      Object.entries(EXPECTED_SNAKE_TO_CAMEL).map(([snake, camel]) => [
        camel,
        snake,
      ]),
    )
    expect(VOTER_FILE_FILTER_KEY_MAP).toEqual(expectedInverse)
  })

  it('lists snake and camel keys in the same (canonical) order', () => {
    expect(AUDIENCE_FILTER_SNAKE_KEYS).toEqual(
      Object.keys(EXPECTED_SNAKE_TO_CAMEL),
    )
    expect(AUDIENCE_FILTER_CAMEL_KEYS).toEqual(
      Object.values(EXPECTED_SNAKE_TO_CAMEL),
    )
    expect(AUDIENCE_FILTER_SNAKE_KEYS).toHaveLength(20)
    expect(AUDIENCE_FILTER_CAMEL_KEYS).toHaveLength(20)
  })

  it('round-trips every key snake -> camel -> snake', () => {
    for (const snakeKey of AUDIENCE_FILTER_SNAKE_KEYS) {
      expect(camelToSnakeAudienceKey(snakeToCamelAudienceKey(snakeKey))).toBe(
        snakeKey,
      )
    }
  })

  it('round-trips every key camel -> snake -> camel', () => {
    for (const camelKey of AUDIENCE_FILTER_CAMEL_KEYS) {
      expect(snakeToCamelAudienceKey(camelToSnakeAudienceKey(camelKey))).toBe(
        camelKey,
      )
    }
  })

  it('helpers agree with the map objects', () => {
    for (const snakeKey of AUDIENCE_FILTER_SNAKE_KEYS) {
      expect(snakeToCamelAudienceKey(snakeKey)).toBe(
        AUDIENCE_FILTER_KEY_MAP[snakeKey],
      )
    }
    for (const camelKey of AUDIENCE_FILTER_CAMEL_KEYS) {
      expect(camelToSnakeAudienceKey(camelKey)).toBe(
        VOTER_FILE_FILTER_KEY_MAP[camelKey],
      )
    }
  })

  it('keeps the snake and camel key sets disjoint (no ambiguity)', () => {
    const snakeSet = new Set<string>(AUDIENCE_FILTER_SNAKE_KEYS)
    const overlap = AUDIENCE_FILTER_CAMEL_KEYS.filter((key) =>
      snakeSet.has(key),
    )
    expect(overlap).toEqual([])
  })

  it('narrows types without unsafe casts at call sites', () => {
    const snake: AudienceFilterSnakeKey = 'audience_superVoters'
    const camel: AudienceFilterCamelKey = snakeToCamelAudienceKey(snake)
    expect(camel).toBe('audienceSuperVoters')
  })
})
