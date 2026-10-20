export const VENDOR_MOCKS_PREFIX = '/v1/vendor-mocks/'

// Vendor clients call their real paths, and CallHub's all end in `/`
// (`/v1/numbers/rent/`). Fastify matches a trailing slash as a different
// route, so without this every mocked CallHub call 404s. Scoped to the mock
// prefix so no other route's matching changes.
export const stripVendorMockTrailingSlash = (url: string): string => {
  if (!url.startsWith(VENDOR_MOCKS_PREFIX)) return url
  const queryStart = url.indexOf('?')
  const path = queryStart === -1 ? url : url.slice(0, queryStart)
  const query = queryStart === -1 ? '' : url.slice(queryStart)
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) + query : url
}
