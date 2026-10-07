import { FetchError } from 'ofetch'
import { extractApiErrorInfo } from 'helpers/extractApiErrorInfo'

// The people-cap refusal, worded by gp-api for whoever drew the shape
// ("This area holds too many people to count. Draw a smaller boundary or
// narrow the list.") and otherwise thrown away for a generic failure toast.
//
// Saving a boundary re-runs the enclosing scan to freeze the shape's
// membership, and that scan is UNFILTERED where the live preview applies the
// list's filters — so the same shape can preview at a few thousand and still
// exceed the cap on save. That gap is what makes this message load-bearing:
// it is the only thing on screen telling the holder to draw smaller, on a
// failure the count gave them no warning about.
//
// Returns undefined for anything that is not a 400, so callers keep their own
// wording for a 409 lock and for genuine failures.
export const boundarySaveErrorMessage = (
  error: unknown,
): string | undefined => {
  if (!(error instanceof FetchError) || error.status !== 400) return undefined
  return extractApiErrorInfo(error.data).message ?? undefined
}
