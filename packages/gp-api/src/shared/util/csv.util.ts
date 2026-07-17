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
 * embedded quote) when it contains a comma, quote, or newline. Without this a
 * comma in a name/address cell silently shifts every column after it.
 */
export const csvEscape = (value: PersonOutput[keyof PersonOutput]): string => {
  if (value === null || value === undefined) return ''
  const str = String(value)
  const mustQuote = /[",\n]/.test(str)
  const escaped = str.replace(/"/g, '""')
  return mustQuote ? `"${escaped}"` : escaped
}
