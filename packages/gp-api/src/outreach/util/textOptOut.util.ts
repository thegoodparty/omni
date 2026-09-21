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
// So: an unambiguous keyword as a standalone *sentence*, an ordinary-verb
// keyword only as the WHOLE message, or an explicit revocation phrase.
// Deliberately NOT the pipeline's looser rule, which treats any message
// whose last word is "stop" as an opt-out — "the noise from the site needs
// to stop" is constituent feedback, not a revocation. Splitting on sentence
// boundaries keeps the case that rule was reaching for ("I hate the noise.
// STOP") without the case it gets wrong, and the whole-message tier keeps
// "I support the budget. End." from scrubbing a supporter.

// Sentence and line boundaries. A standalone keyword anywhere in the message
// counts; a keyword used as an ordinary verb inside a clause does not.
const SEGMENT_BOUNDARY = /[.!?;\n\r]+/

// Politeness wrapper, stripped before the exact-keyword check so
// "unsubscribe please" reads the same as "unsubscribe".
const LEADING_POLITENESS = /^(?:please|pls|plz)\s+/
const TRAILING_POLITENESS = /\s+(?:please|pls|plz)$/

// Keywords with no neutral use as an ordinary sentence. "Stop." and
// "Quit." are imperatives; "stopall", "unsub" and "optout" are not English
// words at all. These are safe to match on any SENTENCE of a longer
// message, which is what catches "I hate the noise. STOP".
const SEGMENT_KEYWORDS = new Set([
  'stop',
  'stopall',
  'stop all',
  'quit',
  'unsubscribe',
  'unsub',
  'optout',
  'opt out',
])

// Keywords that are also ordinary verbs, so they count only when they are
// the ENTIRE message. "I support the budget. End." merely ends a sentence;
// a message whose whole body is "END" is the CTIA exact-match case, which
// carriers and any future vendor honor whether we do or not — and a scrub
// that disagreed with the carrier would keep us paying to text somebody
// already blocked while the opt-out chip read "subscribed".
//
// So the CTIA list is honored as a floor on whole messages and NOT
// stretched to sentence fragments. The phrase list below already covers
// the explicit forms ("remove me from your list") without the bare words.
// `revoke` is dropped entirely: not a CTIA keyword, not a spelling people
// send, and ambiguous on its own.
const WHOLE_MESSAGE_KEYWORDS = new Set(['cancel', 'end', 'remove'])

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

const stripPoliteness = (text: string): string =>
  text.replace(LEADING_POLITENESS, '').replace(TRAILING_POLITENESS, '').trim()

/**
 * True when this reply revokes consent. Producer-agnostic: the only input
 * is the message text as the constituent sent it.
 */
export const isOptOutMessage = (
  content: string | null | undefined,
): boolean => {
  if (!content) return false

  // The CTIA exact-match case: the whole body is the keyword.
  const whole = stripPoliteness(normalizeSegment(content))
  if (WHOLE_MESSAGE_KEYWORDS.has(whole) || SEGMENT_KEYWORDS.has(whole)) {
    return true
  }

  for (const rawSegment of content.split(SEGMENT_BOUNDARY)) {
    const segment = normalizeSegment(rawSegment)
    if (!segment) continue
    if (SEGMENT_KEYWORDS.has(stripPoliteness(segment))) return true
    if (OPT_OUT_PHRASES.some((phrase) => phrase.test(segment))) return true
  }
  return false
}
