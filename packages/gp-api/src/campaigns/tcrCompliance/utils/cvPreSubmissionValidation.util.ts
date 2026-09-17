import { BadRequestException } from '@nestjs/common'

// A distinct class (mirrors PeerlyCvRejectionException) so the TCR service
// can recognize a pre-submission validation failure — vs any other bad
// request — and persist the hold + reasons instead of just rethrowing.
export class CvPreSubmissionValidationException extends BadRequestException {
  constructor(readonly reasons: string[]) {
    super(
      `CV pre-submission validation failed: ${reasons.join('; ')} — the ` +
        'saved filing details must be corrected before this can succeed.',
    )
  }
}

// Hosts that can never be an election authority's own publication of a
// filing — certain, not a judgment call, so these are rejected before any
// fetch or LLM call. Real rejected examples (Peerly, Aug 2026): a Google
// Drive file, a Facebook page, an IRS EIN-assignment page
// (sa.www4.irs.gov/applyein), a goodparty.org candidate page, google.com.
// Matched as apex-or-subdomain, so 'google.com' also catches
// docs.google.com / drive.google.com and 'irs.gov' also catches
// sa.www4.irs.gov.
export const JUNK_FILING_URL_HOSTS = [
  'google.com',
  'facebook.com',
  'youtube.com',
  'goodparty.org',
  'irs.gov',
]

export const isJunkFilingHost = (hostname: string): boolean =>
  JUNK_FILING_URL_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  )
