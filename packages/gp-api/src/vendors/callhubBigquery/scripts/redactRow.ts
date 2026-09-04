// A BigQuery cell can be a scalar, a nested record, or a repeated field.
export type BigqueryCell =
  | string
  | number
  | boolean
  | null
  | BigqueryCell[]
  | { [key: string]: BigqueryCell }

export const REDACTED = '[redacted]'

// A column whose NAME looks like it holds a phone number or a personal
// contact identifier. Matched case-insensitively against the column name so a
// probe never dumps real voter phone numbers to a terminal or a log. Names
// only — we cannot see values before deciding, so we redact on the field name.
const SENSITIVE_COLUMN_PATTERN =
  /(phone|msisdn|mobile|cell|caller|callee|dialed|dialled|contact_number|e164|number)/i

export const isSensitiveColumn = (columnName: string): boolean =>
  SENSITIVE_COLUMN_PATTERN.test(columnName)

// Returns a shallow copy of the row with every sensitive-named column replaced
// by the redaction marker. Non-sensitive columns pass through untouched.
export const redactRow = (
  row: Record<string, BigqueryCell>,
): Record<string, BigqueryCell> =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      isSensitiveColumn(key) ? REDACTED : value,
    ]),
  )
