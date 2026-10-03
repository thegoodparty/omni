import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common'
import { AxiosError, isAxiosError } from 'axios'
import { z } from 'zod'

// Still a 400 to HTTP callers, but a distinct class so the TCR service can
// recognize a CV data rejection (vs any other bad request) and persist the
// rejected status + fire the rejection Segment event — mirrors
// PeerlyBillingException.
export class PeerlyCvRejectionException extends BadRequestException {}

// Campaign Verify refusing the request outright rather than rejecting the
// submitted data: a nested 4xx that is not a 400, e.g. the bare `403
// Forbidden` HTML page CV answered for campaign 327336 on 2026-10-02 while 11
// other submissions the same day succeeded. Also a 400 to callers so the
// compliance agent stops retrying, but deliberately NOT a
// PeerlyCvRejectionException: nothing here says the candidate's filing details
// are wrong, so the record must not be stamped `rejected` and the candidate
// must not be emailed a rejection they cannot act on. Staff get a dedicated
// 10DLC alert instead, because only Peerly can ask CV why.
export class PeerlyCvRefusalException extends BadRequestException {}

// The same refusal, while it is still worth waiting out. Campaign Verify's
// 403s come and go: campaign 327336 was refused about a dozen times across an
// hour on 2026-10-02 and then went through unchanged, so the first refusal
// says "not right now", not "never". A 429 keeps the caller retrying while
// telling it to wait, and — unlike the 502 this used to be — it does not page
// the on-call once per attempt, because this route's alert counts only server
// errors. Thrown by the compliance service, which owns how long a record has
// been refused; the vendor layer only reports what Campaign Verify said.
export class PeerlyCvTemporaryRefusalException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.TOO_MANY_REQUESTS)
  }
}

// Peerly proxies Campaign Verify on submit_cv: a CV failure comes back as
// HTTP 400 with `Error: "Campaign Verify API request failed."` and CV's own
// HTTP status echoed in the nested `status_code` (the same envelope
// getCampaignVerifyRequest already reads for its nested-404 detection). A
// nested 400 means CV rejected the submitted data (e.g. "FEC filing URLs are
// not allowed.") — retrying re-fails deterministically, so it must surface as
// a 4xx to callers rather than the generic 502 that the compliance agent and
// its recovery loop treat as transient and re-dispatch against. Any other
// nested 4xx is CV refusing the request itself (isPeerlyCvRefusal below) and
// is just as deterministic — the reading isPeerlyCvPinRejection already takes
// of the same envelope on the PIN endpoints. A nested 5xx (CV itself down)
// stays on the transient 502 path.

type PeerlyCvErrorBody = {
  Error?: string
  status_code?: number
  details?: string | null
}

const PeerlyCvRejectionDetailsSchema = z.object({
  error: z.string().optional(),
  errors: z.array(z.string()).optional(),
})

const CLIENT_ERROR_MIN: number = HttpStatus.BAD_REQUEST
const SERVER_ERROR_MIN: number = HttpStatus.INTERNAL_SERVER_ERROR

// Peerly's CV envelope: its own 400 wrapping CV's answer. Shared by both
// detectors below so they cannot drift apart on the wrapper while disagreeing
// only about the status CV echoed inside it.
const isPeerlyCvErrorEnvelope = (
  error: unknown,
): error is AxiosError<PeerlyCvErrorBody> =>
  isAxiosError<PeerlyCvErrorBody>(error) &&
  error.response?.status === HttpStatus.BAD_REQUEST &&
  typeof error.response.data?.Error === 'string' &&
  error.response.data.Error.includes('Campaign Verify')

// The HTTP status Campaign Verify itself returned, as echoed in Peerly's
// envelope — null when this is not that envelope. Worth surfacing: it is the
// only thing distinguishing "CV rejected the data" from "CV refused us".
export const getPeerlyCvNestedStatus = (error: unknown): number | null => {
  if (!isPeerlyCvErrorEnvelope(error)) {
    return null
  }
  const nested = error.response?.data?.status_code
  return typeof nested === 'number' ? nested : null
}

export const isPeerlyCvRejection = (error: unknown): boolean =>
  getPeerlyCvNestedStatus(error) === HttpStatus.BAD_REQUEST

// A nested 4xx other than 400: CV declined to process the request at all
// (403 Forbidden, 401, 404, 429…) and gave no field to correct. Retrying with
// the same data gets the same answer, so it must not travel as the transient
// 502 the compliance agent re-dispatches against.
export const isPeerlyCvRefusal = (error: unknown): boolean => {
  const nested = getPeerlyCvNestedStatus(error)
  if (nested === null || isPeerlyCvRejection(error)) {
    return false
  }
  return nested >= CLIENT_ERROR_MIN && nested < SERVER_ERROR_MIN
}

// A refusal's `details` can be a whole HTML error page rather than CV's usual
// JSON — the 403 arrived as `<html>…403 Forbidden…</html>`. That reason is
// read by people (a Slack alert, an agent run blocker, a candidate-facing
// message), so reduce markup to one line and cap the length rather than
// pasting a web page into all three.
const CV_DETAIL_MAX_CHARS = 300

const summarizeCvDetail = (raw: string): string => {
  const withoutMarkup = raw.includes('<') ? raw.replace(/<[^>]*>/g, ' ') : raw
  const collapsed = withoutMarkup.replace(/\s+/g, ' ').trim()
  return collapsed.length > CV_DETAIL_MAX_CHARS
    ? `${collapsed.slice(0, CV_DETAIL_MAX_CHARS)}…`
    : collapsed
}

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
      return summarizeCvDetail(details)
    }
    return summarizeCvDetail(
      parsed.data.error ?? parsed.data.errors?.join('; ') ?? details,
    )
  } catch {
    return summarizeCvDetail(details)
  }
}
