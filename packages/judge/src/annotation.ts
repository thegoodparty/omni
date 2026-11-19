// Every string an eval suite writes to a test's annotations goes through
// `redactSecrets`, because a test report is as public as the repository and an
// annotation carries whatever a case input, a run or a model answer put in it.
// A suite holds no secret of its own, but a token can reach one in a prompt or
// an echoed answer.
const SECRET_PATTERNS: RegExp[] = [
  // Provider and platform keys: `sk-ant-…`, `sk-proj-…`, Clerk's `sk_test_…`.
  /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{12,}/g,
  // Clerk machine-to-machine tokens.
  /\bmt_[A-Za-z0-9_-]{12,}/g,
  // A JWT, which is what a signed-in test user's token arrives as.
  /\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,}){2}/g,
  // A Vercel protection-bypass secret, a hex digest, and any other unbroken
  // run of 32 URL-safe characters. This one is deliberately broad: over-
  // redacting an annotation costs a reader a line of context, and missing a
  // token costs the token.
  /\b[A-Za-z0-9_-]{32,}\b/g,
]

export const REDACTED = '[redacted]'

export const OUTPUT_EXCERPT_LIMIT = 4_000
export const PROMPT_SUMMARY_LIMIT = 300

export const redactSecrets = (text: string): string =>
  SECRET_PATTERNS.reduce(
    (redacted, pattern) => redacted.replace(pattern, REDACTED),
    text,
  )

// Redact before cutting, never after: a cut through a secret leaves a short
// fragment that no pattern matches any more, so the redaction would have
// already passed over what the cut produced.
export const excerpt = (
  text: string,
  limit: number = OUTPUT_EXCERPT_LIMIT,
): string => {
  const redacted = redactSecrets(text)
  return redacted.length <= limit
    ? redacted
    : `${redacted.slice(0, limit)}\n… ${redacted.length - limit} more characters`
}

// One line, so a report can print a prompt's opening without the rest of it
// swallowing the record.
export const summarizePrompt = (prompt: string): string => {
  const collapsed = prompt.replace(/\s+/gu, ' ').trim()
  return collapsed.length <= PROMPT_SUMMARY_LIMIT
    ? collapsed
    : `${collapsed.slice(0, PROMPT_SUMMARY_LIMIT)}…`
}

// A run's output and a judgment are whatever the suite says they are, so this
// takes any value and prints a string as itself.
export const renderValue = <Value>(value: Value): string => {
  if (typeof value === 'string') return value
  const json = JSON.stringify(value, null, 2)
  return json === undefined ? String(value) : json
}
