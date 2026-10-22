import { describe, expect, it } from 'vitest'
import { tokenFromOtlpAuthorization } from './pyroscope'

const basic = (credentials: string) =>
  `Basic ${Buffer.from(credentials).toString('base64')}`

describe('tokenFromOtlpAuthorization', () => {
  it('returns the password half of the OTLP basic credentials', () => {
    expect(tokenFromOtlpAuthorization(basic('1234:glc_secret'))).toBe(
      'glc_secret',
    )
  })

  it('reads a percent-encoded header value', () => {
    expect(
      tokenFromOtlpAuthorization(encodeURIComponent(basic('1234:glc_secret'))),
    ).toBe('glc_secret')
  })

  it('returns undefined without basic credentials', () => {
    expect(tokenFromOtlpAuthorization(undefined)).toBeUndefined()
    expect(tokenFromOtlpAuthorization('Bearer abc')).toBeUndefined()
    expect(tokenFromOtlpAuthorization(basic('no-separator'))).toBeUndefined()
  })
})
