import { describe, it, expect } from 'vitest'
import { MIN_BIO_LENGTH } from './compliance'

describe('MIN_BIO_LENGTH', () => {
  it('is the shared 500-character genuineness threshold', () => {
    expect(MIN_BIO_LENGTH).toBe(500)
  })
})
