import { HttpStatus } from '@nestjs/common'
import { isAxiosError } from 'axios'

// Peerly proxies CampaignVerify for both PIN endpoints and collapses CV's
// answer into HTTP 400 with CV's own status echoed in `status_code` — the
// same envelope isPeerlyCvRejection reads on submit_cv. A nested 4xx is CV
// declining the request itself: a wrong or expired code on verify_pin, or a
// resend CV won't repeat yet on resend_pin (it refuses within 10 days of a
// mailed PIN). Both are expected outcomes of the flow, not incidents — the
// candidate or the staff member who triggered it already sees the failure in
// the response, so paging bot-10dlc-compliance only buries the real ones. A
// nested 5xx means CV itself is down, which still alerts.
type PeerlyCvPinErrorBody = {
  Error?: string
  status_code?: number
}

const CLIENT_ERROR_MIN: number = HttpStatus.BAD_REQUEST
const SERVER_ERROR_MIN: number = HttpStatus.INTERNAL_SERVER_ERROR

export const isPeerlyCvPinRejection = (error: unknown): boolean => {
  if (!isAxiosError<PeerlyCvPinErrorBody>(error)) {
    return false
  }
  if (error.response?.status !== HttpStatus.BAD_REQUEST) {
    return false
  }
  const message = error.response.data?.Error
  const nestedStatus = error.response.data?.status_code
  return (
    typeof message === 'string' &&
    message.includes('Campaign Verify') &&
    typeof nestedStatus === 'number' &&
    nestedStatus >= CLIENT_ERROR_MIN &&
    nestedStatus < SERVER_ERROR_MIN
  )
}
