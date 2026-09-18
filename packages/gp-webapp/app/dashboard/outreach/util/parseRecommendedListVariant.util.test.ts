import { describe, expect, it } from 'vitest'
import { parseRecommendedListVariant } from './parseRecommendedListVariant.util'

describe('parseRecommendedListVariant', () => {
  it('accepts a registry variant', () => {
    expect(parseRecommendedListVariant('persuadeAffinity')).toBe(
      'persuadeAffinity',
    )
  })

  // The query string is anyone's to type; only a variant the registry knows
  // can be asked for, so anything else is a missed preselection.
  it.each([['everyoneEver'], [''], ['PERSUADEAFFINITY'], [null], [undefined]])(
    'ignores %p',
    (raw) => {
      expect(parseRecommendedListVariant(raw)).toBeUndefined()
    },
  )
})
