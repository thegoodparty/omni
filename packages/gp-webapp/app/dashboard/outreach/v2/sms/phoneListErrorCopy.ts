// gp-api tags the phone-list failures a candidate can fix with an errorCode
// (AUDIENCE_TOO_LARGE, NO_TEXTABLE_CONTACTS). Its message text is not shown:
// it can carry internal detail. Anything untagged gets the retry copy.
const FIXABLE_PHONE_LIST_ERRORS: Record<string, string> = {
  AUDIENCE_TOO_LARGE:
    'This list is too big to text at once. Choose a smaller list.',
  NO_TEXTABLE_CONTACTS:
    'No one on this list has a phone number we can text. Choose another list.',
}

export const phoneListErrorCopy = (errorCode?: string | null) =>
  (errorCode && FIXABLE_PHONE_LIST_ERRORS[errorCode]) ??
  "We couldn't prepare this audience. Try again."

// A tagged failure fails the same way on retry, so the retry is not offered.
export const isFixablePhoneListError = (errorCode?: string | null) =>
  Boolean(errorCode && FIXABLE_PHONE_LIST_ERRORS[errorCode])
