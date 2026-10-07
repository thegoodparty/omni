import { describe, it, expect } from 'vitest'
import { parsePositiveListId } from './parsePositiveListId.util'

describe('parsePositiveListId', () => {
  it('parses a positive integer string', () => {
    expect(parsePositiveListId('123')).toBe(123)
  })

  it('parses scientific notation that resolves to a positive integer', () => {
    expect(parsePositiveListId('1e3')).toBe(1000)
  })

  it('parses a leading-space integer string (Number trims whitespace)', () => {
    expect(parsePositiveListId(' 1')).toBe(1)
  })

  it('rejects a float string', () => {
    expect(parsePositiveListId('1.5')).toBeUndefined()
  })

  it('rejects zero', () => {
    expect(parsePositiveListId('0')).toBeUndefined()
  })

  it('rejects a negative integer', () => {
    expect(parsePositiveListId('-4')).toBeUndefined()
  })

  it('rejects an empty string (Number("") is 0)', () => {
    expect(parsePositiveListId('')).toBeUndefined()
  })

  it('rejects a non-numeric string', () => {
    expect(parsePositiveListId('not-a-number')).toBeUndefined()
  })

  it('rejects null', () => {
    expect(parsePositiveListId(null)).toBeUndefined()
  })

  it('rejects undefined', () => {
    expect(parsePositiveListId(undefined)).toBeUndefined()
  })
})
