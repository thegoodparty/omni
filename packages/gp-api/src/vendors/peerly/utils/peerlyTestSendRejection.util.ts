import { HttpStatus } from '@nestjs/common'
import { isAxiosError } from 'axios'

// Peerly refusals on the admin test send that depend on the number the
// reviewer typed. Each is matched on Peerly's wording as well as its status:
// Peerly also answers 400 when our own request is malformed (the missing
// test_list_id of 2026-09), and that must keep paging instead of being shown
// to the reviewer as their mistake. Bodies are as seen in prod, ENG-11262.
type PeerlyErrorBody = { Error?: string }

const peerlyErrorText = (error: unknown): string | null => {
  if (!isAxiosError<PeerlyErrorBody>(error)) return null
  const message = error.response?.data?.Error
  return typeof message === 'string' ? message : null
}

const CLIENT_ERROR_MIN: number = HttpStatus.BAD_REQUEST
const SERVER_ERROR_MIN: number = HttpStatus.INTERNAL_SERVER_ERROR

// `addcontact` answers 403 for a landline or VoIP number.
export const isPeerlyNotCellRejection = (error: unknown): boolean => {
  if (!isAxiosError(error)) return false
  const status = error.response?.status ?? 0
  return (
    status >= CLIENT_ERROR_MIN &&
    status < SERVER_ERROR_MIN &&
    (peerlyErrorText(error)?.includes('Not a cell number') ?? false)
  )
}

export const NOT_CELL_MESSAGE =
  'Peerly can only text cell numbers, and this number is not one. ' +
  'Try a different number.'

const SEND_REJECTIONS = [
  {
    match: 'not in test_list_id',
    message:
      'Peerly would not add this number to the test list, so it cannot ' +
      'text it. Try a different number.',
  },
  {
    // Peerly has not said what this means for a test send, so its wording
    // is passed through as is.
    match: 'Lead already exists in leads table',
    message:
      'Peerly would not text this number (“Lead already exists in ' +
      'leads table”). Try a different number.',
  },
]

export const peerlyTestSendRejectionMessage = (
  error: unknown,
): string | null => {
  if (!isAxiosError(error)) return null
  if (error.response?.status !== HttpStatus.BAD_REQUEST) return null
  const text = peerlyErrorText(error)
  if (!text) return null
  return (
    SEND_REJECTIONS.find(({ match }) => text.includes(match))?.message ?? null
  )
}
