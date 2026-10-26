import { describe, expect, it } from 'vitest'
import { stripVendorMockTrailingSlash } from './vendorMockUrl.util'

describe('stripVendorMockTrailingSlash', () => {
  it('strips the trailing slash from a vendor-mock path', () => {
    expect(
      stripVendorMockTrailingSlash('/v1/vendor-mocks/callhub/v1/numbers/rent/'),
    ).toBe('/v1/vendor-mocks/callhub/v1/numbers/rent')
  })

  it('keeps the query string when stripping', () => {
    expect(
      stripVendorMockTrailingSlash(
        '/v1/vendor-mocks/callhub/v1/dnc_contacts/?page_size=100',
      ),
    ).toBe('/v1/vendor-mocks/callhub/v1/dnc_contacts?page_size=100')
  })

  it('leaves a vendor-mock path without a trailing slash unchanged', () => {
    expect(
      stripVendorMockTrailingSlash(
        '/v1/vendor-mocks/callhub/v1/phonebooks/abc/numbers_count',
      ),
    ).toBe('/v1/vendor-mocks/callhub/v1/phonebooks/abc/numbers_count')
  })

  it('leaves every other route unchanged', () => {
    expect(stripVendorMockTrailingSlash('/v1/campaigns/mine/')).toBe(
      '/v1/campaigns/mine/',
    )
  })
})
