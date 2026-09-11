// The formatted phone field's one non-obvious rule, shared by the sign-up
// form and the Google phone step. It lives here because it has already
// needed one correction (an over-long input was being read as a delete), and
// a second copy would have silently kept the bug.
//
// Kept a pure string->string function rather than a handler factory so each
// call site keeps its own state wiring, and so the rule itself is directly
// testable.
const MAX_DIGITS = 11

export const nextPhoneDigits = (current: string, rawInput: string): string => {
  const digits = rawInput.replace(/\D/g, '')
  // AsYouType puts back the ')' a backspace just removed, so a keystroke that
  // leaves the digit count unchanged was a delete of punctuation. Compare
  // before capping: capping an over-long input leaves the count unchanged
  // too, and reading that as a delete would eat a real digit.
  return digits === current ? current.slice(0, -1) : digits.slice(0, MAX_DIGITS)
}
