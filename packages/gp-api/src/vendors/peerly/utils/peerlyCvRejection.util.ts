import { BadRequestException, HttpStatus } from '@nestjs/common'
import { isAxiosError } from 'axios'
import { z } from 'zod'

// Still a 400 to HTTP callers, but a distinct class so the TCR service can
// recognize a CV data rejection (vs any other bad request) and persist the
// rejected status + fire the rejection Segment event — mirrors
// PeerlyBillingException.
export class PeerlyCvRejectionException extends BadRequestException {}

// Peerly proxies Campaign Verify on submit_cv: a CV failure comes back as
// HTTP 400 with `Error: "Campaign Verify API request failed."` and CV's own
// HTTP status echoed in the nested `status_code` (the same envelope
// getCampaignVerifyRequest already reads for its nested-404 detection). A
// nested 400 means CV rejected the submitted data (e.g. "FEC filing URLs are
// not allowed.") — retrying re-fails deterministically, so it must surface as
// a 4xx to callers rather than the generic 502 that the compliance agent and
// its recovery loop treat as transient and re-dispatch against. A nested 5xx
// (CV itself down) stays on the transient 502 path.

type PeerlyCvErrorBody = {
  Error?: string
  status_code?: number
  details?: string | null
}

const PeerlyCvRejectionDetailsSchema = z.object({
  error: z.string().optional(),
  errors: z.array(z.string()).optional(),
})

export const isPeerlyCvRejection = (error: unknown): boolean =>
  isAxiosError<PeerlyCvErrorBody>(error) &&
  error.response?.status === HttpStatus.BAD_REQUEST &&
  error.response.data?.status_code === HttpStatus.BAD_REQUEST &&
  typeof error.response.data.Error === 'string' &&
  error.response.data.Error.includes('Campaign Verify')

// CV's rejection reason rides in `details` as a JSON-encoded string, e.g.
// '{"error":"FEC filing URLs are not allowed.","errors":[...]}'. Parse it out
// so the thrown message carries the actionable reason; fall back to the raw
// string if Peerly ever changes the encoding.
export const getPeerlyCvRejectionDetail = (error: unknown): string => {
  if (!isAxiosError<PeerlyCvErrorBody>(error)) {
    return ''
  }
  const details = error.response?.data?.details
  if (typeof details !== 'string' || details === '') {
    return ''
  }
  try {
    const parsed = PeerlyCvRejectionDetailsSchema.safeParse(JSON.parse(details))
    if (!parsed.success) {
      return details
    }
    return parsed.data.error ?? parsed.data.errors?.join('; ') ?? details
  } catch {
    return details
  }
}
