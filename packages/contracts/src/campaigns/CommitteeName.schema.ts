import { z } from 'zod'

// A candidate with no committee still has to fill the required field, and
// reaches for a stand-in ("N/A", "none", "self"). That string is copied
// verbatim into the Peerly 10DLC brand's displayName/companyName and the SMS
// "Paid for by" footer, and Peerly can only repair it by hand once the PIN is
// already out (identity 11541044, 2026-10-07). Compare the normalized value
// against a list rather than pattern-matching free text, so a real name that
// merely contains one of these words still passes.
const PLACEHOLDER_COMMITTEE_NAMES = new Set([
  'n/a',
  'na',
  'n a',
  'none',
  'null',
  'nil',
  'no',
  'tbd',
  'tba',
  'self',
  'me',
  'myself',
  'test',
  'testing',
  'unknown',
  'not applicable',
  'not available',
  'no committee',
  'pending',
  'later',
  'x',
  'xx',
  'xxx',
  'asdf',
])

const normalizeCommitteeName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')

export const isPlaceholderCommitteeName = (value: string): boolean => {
  const normalized = normalizeCommitteeName(value)
  return normalized === '' || PLACEHOLDER_COMMITTEE_NAMES.has(normalized)
}

export const COMMITTEE_NAME_PLACEHOLDER_MESSAGE =
  'That looks like a placeholder, not a committee name. Enter the name on ' +
  'your filing, or "Your name for office" if you have no committee.'

export const CommitteeNameSchema = z
  .string()
  .trim()
  .min(1, 'A committee name is required')
  .refine(
    (value) => !isPlaceholderCommitteeName(value),
    COMMITTEE_NAME_PLACEHOLDER_MESSAGE,
  )
