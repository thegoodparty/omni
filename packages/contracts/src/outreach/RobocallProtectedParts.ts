// What a robocall script locks so it cannot be edited out of the spoken
// disclosures the recording check listens for (RobocallCompliance.schema.ts):
// the candidate naming themselves, and the line saying who paid for the call
// with the number to call back. The webapp locks these in the script field,
// and gp-api hides them from the model on Improve, so both find them here.
//
// The recording check, not this, is the gate: a script can be read aloud
// differently. Locking makes a passing recording likely, not certain.

export type RobocallProtectedPart = {
  rule: 'candidate_name' | 'disclosure'
  kind: 'phrase'
  text: string
  // Where the locked copy starts in the script, as in SmsProtectedPart.
  start: number
}

// A plain grouped US number (XXX-XXX-XXXX, dropping a country-code 1), so the
// script reads "414-485-8077" rather than eleven digits read one by one.
// Anything that is not a 10- or 11-digit US number is returned as given.
export const formatRobocallCallbackNumber = (raw: string): string => {
  const digits = raw.replace(/\D/g, '')
  const local =
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  return local.length === 10
    ? `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`
    : raw
}

// The spoken disclosure, written by the app rather than the model: who paid
// for the call, then the number to call back.
export const robocallDisclosureLine = (
  sponsor: string,
  callbackNumber: string,
): string =>
  `Paid for by ${sponsor}, ${formatRobocallCallbackNumber(callbackNumber)}.`

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const findWords = (script: string, words: string): RegExpExecArray | null =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(words)}(?![\\p{L}\\p{N}])`,
    'iu',
  ).exec(script)

export const deriveRobocallProtectedParts = (
  script: string,
  context: { candidateNames?: string[] } = {},
): RobocallProtectedPart[] => {
  const parts: RobocallProtectedPart[] = []

  // The disclosure is the script's closing line, so the last "paid for by"
  // is it. One unit to the end of its line: the sponsor and the number are
  // what the line is for, and a gap between them would let wording change
  // what it says, as with the SMS disclaimer.
  const phrases = [...script.matchAll(/paid\s+for\s+by/gi)]
  const last = phrases[phrases.length - 1]
  let disclosure: { start: number; text: string } | null = null
  if (last) {
    const start = last.index ?? 0
    const line = /^[^\n]*/.exec(script.slice(start))?.[0] ?? ''
    disclosure = { start, text: line.trimEnd() }
  }

  // The name the candidate gives for themselves, outside the disclosure
  // (whose sponsor usually repeats it): the full name as written, otherwise
  // the first of its words the script uses ("This is Sarah").
  const outside = disclosure
    ? script.slice(0, disclosure.start) +
      ' '.repeat(disclosure.text.length) +
      script.slice(disclosure.start + disclosure.text.length)
    : script
  const names = (context.candidateNames ?? [])
    .map((name) => name.trim())
    .filter(Boolean)
  const words = names
    .flatMap((name) => name.split(/\s+/))
    .filter((word) => word.length >= 3)
  const found =
    names.map((name) => findWords(outside, name)).find(Boolean) ??
    words.map((word) => findWords(outside, word)).find(Boolean)
  if (found) {
    parts.push({
      rule: 'candidate_name',
      kind: 'phrase',
      text: found[0],
      start: found.index,
    })
  }

  if (disclosure) {
    parts.push({ rule: 'disclosure', kind: 'phrase', ...disclosure })
  }
  return parts
}
