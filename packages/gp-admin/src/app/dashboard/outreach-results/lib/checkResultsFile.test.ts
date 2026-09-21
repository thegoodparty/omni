import { describe, it, expect } from 'vitest'
import {
  checkResultsFile,
  EMPTY_NAME_MESSAGE,
  NO_USABLE_ROWS_MESSAGE,
  TOO_LARGE_MESSAGE,
  uploadBlocker,
} from './checkResultsFile'
import { MAX_RESULTS_FILE_BYTES } from '../types'

const GOOD = 'phone_number,message_text\n5551234567,Fix Elm St\n'

const blockerFor = (csv: string, fileName = 'results.csv') =>
  uploadBlocker(checkResultsFile({ fileName, csv }))

describe('checkResultsFile', () => {
  it('passes a whole file and hands back what it read', () => {
    const result = checkResultsFile({ fileName: 'results.csv', csv: GOOD })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows).toHaveLength(1)
    expect(uploadBlocker(result)).toBeNull()
  })

  it('refuses a file with no name', () => {
    expect(blockerFor(GOOD, '   ')).toBe(EMPTY_NAME_MESSAGE)
  })

  it('refuses an empty file', () => {
    expect(blockerFor('   \n')).toMatch(/empty/i)
  })

  it('refuses a file over the size cap, measured in bytes not characters', () => {
    // Two-byte characters, so a string of half the cap's length still
    // exceeds it. A char-count check would let this through.
    const wide = 'é'.repeat(MAX_RESULTS_FILE_BYTES / 2 + 1)
    expect(blockerFor(wide)).toBe(TOO_LARGE_MESSAGE)
  })

  it('refuses a file with a header but no usable rows', () => {
    expect(blockerFor('phone_number,message_text\n,No phone here\n')).toBe(
      NO_USABLE_ROWS_MESSAGE
    )
  })

  // The motivating bug. This rule has to hold wherever the check runs, which
  // is why both the page and the server action call this module rather than
  // keeping their own copies.
  it('refuses a file that was cut off inside a quoted reply', () => {
    const whole =
      'phone_number,message_text\n5551234567,"Fix Elm St"\n5559876543,"Yes"\n'
    expect(blockerFor(whole)).toBeNull()
    expect(blockerFor(whole.slice(0, -4))).toMatch(/incomplete/i)
  })

  it('reports the parse error rather than a generic refusal', () => {
    expect(blockerFor('name,note\nAva,Hi\n')).toMatch(/Missing required column/)
  })
})
