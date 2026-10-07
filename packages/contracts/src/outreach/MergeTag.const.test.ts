import { describe, expect, it } from 'vitest'
import { MERGE_TAGS, mergeTagToken } from './MergeTag.const'

describe('mergeTagToken', () => {
  it('gives Peerly the single-brace token and Serve the double-brace one', () => {
    expect(mergeTagToken('first_name', 'peerly')).toBe('{first_name}')
    expect(mergeTagToken('first_name', 'serve')).toBe('{{first_name}}')
  })

  it('never gives two channels the same token for a tag', () => {
    for (const tag of MERGE_TAGS) {
      expect(tag.token.peerly).not.toBe(tag.token.serve)
    }
  })
})
