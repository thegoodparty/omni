import { describe, it, expect } from 'vitest'
import { trimCustomSegmentName, MAX_SEGMENT_NAME_LENGTH } from './segments.util'

describe('trimCustomSegmentName', () => {
  it('returns the name unchanged when at or under the limit', () => {
    const name = 'a'.repeat(MAX_SEGMENT_NAME_LENGTH)
    expect(trimCustomSegmentName(name)).toBe(name)
  })

  it('truncates a generic long name to exactly the limit, ellipsis included', () => {
    const name = 'a'.repeat(MAX_SEGMENT_NAME_LENGTH + 10)
    const result = trimCustomSegmentName(name)
    expect(result.length).toBe(MAX_SEGMENT_NAME_LENGTH)
    expect(result.endsWith('...')).toBe(true)
  })

  it('slices to the end of the word when "Campaign" fits inside the limit', () => {
    const name = 'My Campaign with a very long tail that overflows the limit'
    const result = trimCustomSegmentName(name)
    expect(result).toBe('My Campaign')
  })

  it('stays within the limit when "Campaign" itself sits past it', () => {
    const name = `${'x'.repeat(MAX_SEGMENT_NAME_LENGTH)} Campaign`
    const result = trimCustomSegmentName(name)
    expect(result.length).toBe(MAX_SEGMENT_NAME_LENGTH)
    expect(result.endsWith('...')).toBe(true)
  })

  it('falls back to a placeholder for empty input', () => {
    expect(trimCustomSegmentName('')).toBe('custom segment')
  })
})
