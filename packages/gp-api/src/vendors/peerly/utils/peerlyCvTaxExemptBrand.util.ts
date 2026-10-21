import {
  HttpExceptionOptions,
  HttpStatus,
  UnprocessableEntityException,
} from '@nestjs/common'
import { isAxiosError } from 'axios'

// Peerly refuses to attach a CV token to a brand TCR tagged as a 501(c)
// tax-exempt non-profit. We register every brand as NON_PROFIT on purpose
// (PEERLY_ENTITY_TYPE), so only the brands TCR also tagged tax-exempt hit
// this. No retry can succeed: the brand needs a vendor-side fix, so this is a
// 422 the candidate can act on (contact support) rather than a 502 that pages
// and invites them to keep resubmitting the PIN. Observed body (ENG-11389):
// { Error: 'Unable to submit CV token.\nCampaign verify vet cannot be
//   imported for a non-profit brand having 501c tax-exempt status' }
type PeerlyCvTokenErrorBody = {
  Error?: string
}

export const CAMPAIGN_VERIFY_TAX_EXEMPT_BRAND =
  'CAMPAIGN_VERIFY_TAX_EXEMPT_BRAND'

export const isPeerlyCvTaxExemptBrandRejection = (error: unknown): boolean => {
  if (!isAxiosError<PeerlyCvTokenErrorBody>(error)) {
    return false
  }
  if (error.response?.status !== HttpStatus.BAD_REQUEST) {
    return false
  }
  const message = error.response.data?.Error
  if (typeof message !== 'string') {
    return false
  }
  const normalized = message.toLowerCase()
  return (
    normalized.includes('non-profit brand') && normalized.includes('tax-exempt')
  )
}

// Matches the HttpExceptionConstructor handleApiError builds from, so the
// errorCode body survives its `new ExceptionClass(message, { cause })`.
export class PeerlyCvTaxExemptBrandException extends UnprocessableEntityException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super({ message, errorCode: CAMPAIGN_VERIFY_TAX_EXEMPT_BRAND }, options)
  }
}
