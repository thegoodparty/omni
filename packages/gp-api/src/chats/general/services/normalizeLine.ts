// Normalization shared by every "does the reply already carry this line"
// check, and mirrored by the chat bench so both sides agree on what counts as
// the same line: Unicode compatibility form (NFKC, which also turns a
// non-breaking space into a space), curly quotes and apostrophes folded to
// straight ones, whitespace collapsed. Dashes and case are left alone on
// purpose: an em dash swapped for a period is a real wording change, and so
// is a capital. (ordinances/services/ordinanceFidelity.util.ts has a sibling
// that folds dashes too; that one compares a draft against a source, where a
// dash swap is noise. The two differ on purpose.)
const CURLY_SINGLE = /[‘’‚‛]/g
const CURLY_DOUBLE = /[“”„‟]/g

export const normalizeLine = (text: string): string =>
  text
    .normalize('NFKC')
    .replace(CURLY_SINGLE, "'")
    .replace(CURLY_DOUBLE, '"')
    .replace(/\s+/g, ' ')
    .trim()

export const containsLine = (text: string, line: string): boolean =>
  normalizeLine(text).includes(normalizeLine(line))
