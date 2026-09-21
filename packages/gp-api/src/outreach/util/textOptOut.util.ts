// The one definition of "this reply is an opt-out", for every text product
// and every inbound producer.
//
// It lives in the delivery layer because that is the only place both
// producers pass through. Polls today reads `is_opt_out` off the analysis
// pipeline's artifact (packages/gp-ai/serve/classify/data_cleaner.py,
// STOP_PATTERNS) and a staff upload has no such field at all — two
// definitions, one of which nobody can see from the API. The pipeline's flag
// is therefore a hint and not the source of truth: producers hand this layer
// the message text and nothing else, and this predicate decides.
//
// Scope of the predicate. Two failure directions, both real:
//  - Missing an opt-out leaves somebody on the next send. The FCC's 2024
//    revocation rule requires honoring the CTIA keywords exactly AND any
//    other text a reasonable person would read as revocation.
//  - Inventing an opt-out silences a constituent permanently, since
//    findOptedOutPersonIds scrubs org-wide and forever.
//
// So: exact match on a standalone keyword *sentence*, plus an explicit
// revocation phrase. Deliberately NOT the pipeline's looser rule, which
// treats any message whose last word is "stop" as an opt-out — "the noise
// from the site needs to stop" is constituent feedback, not a revocation.
// Splitting on sentence boundaries keeps the case that rule was reaching
// for ("I hate the noise. STOP") without the case it gets wrong.

// Sentence and line boundaries. A standalone keyword anywhere in the message
// counts; a keyword used as an ordinary verb inside a clause does not.
const SEGMENT_BOUNDARY = /[.!?;\n\r]+/

// Politeness wrapper, stripped before the exact-keyword check so
// "unsubscribe please" reads the same as "unsubscribe".
const LEADING_POLITENESS = /^(?:please|pls|plz)\s+/
const TRAILING_POLITENESS = /\s+(?:please|pls|plz)$/

// The six CTIA keywords carriers require be honored on an exact match,
// plus the spellings people actually send. Matched against a whole
// segment, never a substring.
const OPT_OUT_KEYWORDS = new Set([
  'stop',
  'stopall',
  'stop all',
  'unsubscribe',
  'unsub',
  'cancel',
  'end',
  'quit',
  'optout',
  'opt out',
  'remove',
  'revoke',
])

// Unambiguous revocation phrases. Matched anywhere in a segment, because
// "hey, stop texting me" is a revocation wherever the clause starts.
const OPT_OUT_PHRASES: RegExp[] = [
  /\b(?:stop|quit|cease) (?:texting|messaging|contacting|calling|emailing) me\b/,
  /\b(?:stop|quit) (?:sending me|sending|the) (?:texts?|text messages?|messages?|msgs?)\b/,
  /\b(?:dont|do not) (?:text|message|msg|contact|call|email) me\b/,
  /\b(?:remove|delete) (?:me|my (?:number|phone|cell|name|info|contact|email))\b/,
  /\btake (?:me|my (?:number|name)) off\b/,
  /\b(?:unsubscribe|opt out) me\b/,
  /\bopt me out\b/,
  /\bno more (?:texts?|messages?|msgs?)\b/,
  /\blose my number\b/,
  /\bleave me alone\b/,
  /\bi (?:want|wish|would like) to (?:unsubscribe|opt out|be removed)\b/,
  /\b(?:remove|take) (?:me )?(?:off|from) (?:your |the )?(?:list|mailing list|texts?|messages?)\b/,
]

// Lowercase, drop apostrophes so "don't" and "dont" are one spelling, turn
// every other non-alphanumeric into a space, collapse runs.
const normalizeSegment = (segment: string): string =>
  segment
    .toLowerCase()
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * True when this reply revokes consent. Producer-agnostic: the only input
 * is the message text as the constituent sent it.
 */
export const isOptOutMessage = (
  content: string | null | undefined,
): boolean => {
  if (!content) return false
  for (const rawSegment of content.split(SEGMENT_BOUNDARY)) {
    const segment = normalizeSegment(rawSegment)
    if (!segment) continue
    const bare = segment
      .replace(LEADING_POLITENESS, '')
      .replace(TRAILING_POLITENESS, '')
      .trim()
    if (OPT_OUT_KEYWORDS.has(bare)) return true
    if (OPT_OUT_PHRASES.some((phrase) => phrase.test(segment))) return true
  }
  return false
}
