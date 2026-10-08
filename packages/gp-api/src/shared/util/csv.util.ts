import type { PersonOutput } from '@/contacts/schemas/person.schema'

const CSV_FORMULA_PREFIXES = ['=', '+', '-', '@']

/**
 * Neutralize CSV / spreadsheet formula injection (CWE-1236): a cell whose first
 * character is `=`, `+`, `-`, or `@` is executed as a formula by Excel/Sheets
 * when the export is opened, so a crafted value can exfiltrate data or run a
 * command on the opener's machine. Prefix a single quote to force the cell to
 * text — the same neutralization the poll-responses export applies in SQL.
 */
export const neutralizeCsvFormula = (value: string): string =>
  CSV_FORMULA_PREFIXES.includes(value[0] ?? '') ? `'${value}` : value

/**
 * RFC 4180 field quoting: wraps a value in double quotes (doubling any
 * embedded quote) when it contains a comma, quote, carriage return, or
 * newline. Without this a comma in a name/address cell silently shifts every
 * column after it.
 *
 * A bare carriage return counts: RFC 4180 names CR alongside LF, and every
 * CSV reader we hand files to (Peerly's phone-list upload included) treats a
 * lone CR as a row break. An unquoted CR inside one cell therefore splits
 * that row in two and the receiving parser rejects the whole file.
 */
// A '+'/'-'-prefixed value of only digits and phone punctuation (an E.164
// phone, a negative number) can't call a function or reference a cell, so
// neutralizing it would only corrupt real data (phones become "'+1555...").
const INERT_NUMERIC = /^[+-][\d\s()./-]+$/

/**
 * What a CSV we failed to hand to a vendor looked like, in numbers only.
 *
 * When a vendor refuses an upload it tells us nothing about why, and the file
 * itself is other people's names and phone numbers, so it cannot be logged.
 * These three counts are enough to tell a vendor-side wobble (a file of the
 * usual shape, refused once) from a file whose contents a reader could choke
 * on: `controlCharRows` is non-zero only when a cell carried a control
 * character, which is the one way voter data flowing through this export can
 * produce a row a strict CSV reader refuses.
 */
export const csvShape = (
  csv: Buffer,
): { bytes: number; rows: number; controlCharRows: number } => {
  const text = csv.toString('utf8')
  const lines = text.split('\n').filter((line) => line.length > 0)
  const controlChars = /[\u0000-\u0008\u000B-\u001F\u007F]/
  return {
    bytes: csv.length,
    // The header row is not a recipient.
    rows: Math.max(lines.length - 1, 0),
    controlCharRows: lines.filter((line) => controlChars.test(line)).length,
  }
}

export const csvEscape = (value: PersonOutput[keyof PersonOutput]): string => {
  if (value === null || value === undefined) return ''
  const raw = String(value)
  const str = INERT_NUMERIC.test(raw) ? raw : neutralizeCsvFormula(raw)
  const mustQuote = /[",\r\n]/.test(str)
  const escaped = str.replace(/"/g, '""')
  return mustQuote ? `"${escaped}"` : escaped
}
