import { DraftedCaseSchema } from '../schemas/draftedCase.schema'
import { SecondReadResponseSchema } from '../schemas/caseScoutModel.schema'
import { extractJsonArray } from './extractJson.util'

// The PII gate (TDD § 2, Implementation Notes § 4). omni is public, so a case
// must never identify a real user. The layers run in order and the first
// failure wins; the gate is never loosened to let a draft through. Every
// reason names a rule, never the matched text.

export const MIN_DENYLIST_TERM_LENGTH = 3
export const COPIED_TEXT_RUN_LENGTH = 8
const SECOND_READ_MAX_ATTEMPTS = 2

// Python's \w and \d are Unicode-aware; JavaScript's are ASCII unless spelled
// as property classes.
const WORD = String.raw`[\p{L}\p{N}_]`
const EMAIL = new RegExp(
  String.raw`[\p{L}\p{N}_.+-]+@[\p{L}\p{N}_-]+\.[\p{L}\p{N}_.]+`,
  'u',
)
const PHONE = new RegExp(
  String.raw`(?<!\p{Nd})(?:\+?1[-.\s]?)?\(?\p{Nd}{3}\)?[-.\s]?\p{Nd}{3}` +
    String.raw`[-.\s]?\p{Nd}{4}(?!\p{Nd})`,
  'u',
)
// A local number with no area code: an exchange (never starting 0 or 1) and a
// line. The lookarounds keep zips, decimals and digit groups out.
const LOCAL_PHONE = new RegExp(
  String.raw`(?<![\p{Nd},.$])([2-9]\p{Nd}{2})([-.\s])(\p{Nd}{4})` +
    String.raw`(?!\p{Nd}|[.,]\p{Nd})`,
  'gu',
)
const YEAR = /^(?:19|20)\d{2}$/u

// "Ordinance 245-2025" and "500-1000 voters" share a phone's shape. Only a
// hyphen reads as one of those: a year for a line, or a rising pair whose
// second number is a round hundred. "555 1999" and "210-5550" stay phones.
const isLocalPhone = ([
  ,
  exchange = '',
  separator,
  line = '',
]: RegExpMatchArray) =>
  separator !== '-' ||
  !(
    YEAR.test(line) ||
    (exchange.endsWith('0') &&
      Number(line) % 100 === 0 &&
      Number(line) > Number(exchange))
  )

const URL_PATTERN = new RegExp(
  String.raw`(?<!${WORD})(?:https?://|www\.)\S+`,
  'giu',
)
const EMAILS = new RegExp(EMAIL.source, 'gu')
const HOST_RUN = /^[\p{L}\p{N}_.-]+/u
const URL_SCHEME = /^https?:\/\//iu
const TRAILING_PUNCTUATION = /[.,;:!?'")\]}>]+$/u
const HOSTNAME = /^[a-z0-9.-]+$/u
const PORT = /:\d+$/u

// The reserved example domains (RFC 2606) name no one, so a drafter can write
// a link or an address on them. Only the host decides: a lookalike that merely
// contains one ("example.org.evil.com", "user@example.com.evil.net") blocks.
const EXAMPLE_DOMAINS = ['example.com', 'example.org', 'example.net']

const isExampleHost = (host: string): boolean =>
  HOSTNAME.test(host) &&
  EXAMPLE_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  )

// The host read on from the "@" over every character a host can hold, not
// just what EMAIL matched, so "a@example.com-evil.net" is read whole.
const emailHost = (text: string, match: RegExpMatchArray): string => {
  const at = (match.index ?? 0) + match[0].indexOf('@')
  const run = HOST_RUN.exec(text.slice(at + 1))?.[0] ?? ''
  return run.replace(/\.+$/u, '').toLowerCase()
}

// Anything past the scheme up to the first path, query or fragment character.
// A userinfo part ("https://example.com@evil.com/") can hide the real host,
// so it never passes.
const urlHost = (url: string): string | undefined => {
  const authority = url
    .replace(URL_SCHEME, '')
    .split(/[/?#\\]/u)[0]
    ?.replace(TRAILING_PUNCTUATION, '')
  if (authority === undefined || authority.includes('@')) return undefined
  return authority.replace(PORT, '').replace(/\.+$/u, '').toLowerCase()
}

export type CaseCandidate = {
  caseId: string
  condition: string
  handledWhen: string
  source: string
  split: string
  question?: string
  turns?: string[]
}

export type GateRule =
  | 'denylist'
  | 'copiedText'
  | 'contactPattern'
  | 'secondRead'
  | 'schema'

// `flagged` is what a second read that blocked listed. It may hold real
// identifiers, so the draft job never writes it anywhere; only the quality
// bench keeps it, in its local, gitignored results.
export type GateResult =
  | { passed: true }
  | { passed: false; rule: GateRule; reason: string; flagged?: string[] }

// The second read failed to run at all (no answer to parse). Blocks at once,
// with no retry; an unparseable answer gets one retry instead.
export class SecondReadCallError extends Error {}

// The draft's text, and the real chat it was drafted from: every role and tool
// input, the copy check's own source.
export type SecondReadCall = (
  draftText: string,
  sourceText: string,
) => Promise<string>

export type CaseText = Pick<
  CaseCandidate,
  'caseId' | 'condition' | 'handledWhen' | 'question' | 'turns'
>

export type OutboundDraft = { case: CaseText } | { needsSetup: string }

// Stands in for a needs-setup line that failed the gate, in the bundle and
// the ledger alike.
export const WITHHELD_NEEDS_SETUP = '(withheld: the line failed the PII gate)'

// Hyphens and underscores become spaces, so a spaced denylist term such as
// "Maple Falls" can match maple-falls-ward-2.
const deslug = (caseId: string): string => caseId.replace(/[-_]+/gu, ' ').trim()

// Every drafter-written string that can leave prod, as the gate reads it. The
// gate checks exactly this list and caseScoutDeidentifier.eval.ts grades
// exactly this list, so a new outbound field goes here and nowhere else.
export const outboundStrings = (draft: OutboundDraft): string[] =>
  'needsSetup' in draft
    ? [draft.needsSetup]
    : [
        draft.case.condition,
        draft.case.handledWhen,
        ...(draft.case.question ? [draft.case.question] : []),
        ...(draft.case.turns ?? []),
        deslug(draft.case.caseId),
      ]

const escapeRegExp = (term: string): string =>
  term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const checkDenylist = (
  fields: string[],
  denylist: string[],
): string | undefined => {
  // Each term also tries its punctuation as one space, so "Delacroix-Venn"
  // still matches the de-slugged caseId "delacroix venn asks about turnout".
  const terms = [
    ...new Set(
      denylist
        .flatMap((term) => [term, term.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()])
        .filter((term) => term.length >= MIN_DENYLIST_TERM_LENGTH),
    ),
  ].sort((a, b) => b.length - a.length)
  if (terms.length === 0) return undefined
  // Lookarounds rather than \b, so a term that starts or ends with a
  // non-word character ("City Council (District 4)") still matches.
  const pattern = new RegExp(
    `(?<!${WORD})(?:${terms.map(escapeRegExp).join('|')})(?!${WORD})`,
    'iu',
  )
  return pattern.test(fields.join(' '))
    ? 'a denylist term matched a case field'
    : undefined
}

const SENTENCE_BREAK = /[.!?\n]/u

const runsOf = <T>(words: T[]): T[][] =>
  words
    .slice(0, Math.max(0, words.length - COPIED_TEXT_RUN_LENGTH + 1))
    .map((_, i) => words.slice(i, i + COPIED_TEXT_RUN_LENGTH))

// Copying a conversation is fine; copying who was in it is not. A source run
// counts only when, as written, it holds a digit or a word capitalized
// mid-sentence ("I" aside). An apostrophe splits a contraction, so "I'm" reads
// as "I" and "m". caseScoutDeidentifier.eval.ts applies the same test with its
// own code, so the eval measures this gate rather than echoing it.
const identifyingSourceRuns = (text: string): string[] => {
  const words = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((match, i, all) => {
    const token = match[0]
    const prev = all[i - 1]
    const sentenceStart =
      prev === undefined ||
      SENTENCE_BREAK.test(text.slice(prev.index + prev[0].length, match.index))
    return {
      word: token.toLowerCase(),
      identifying:
        /\p{N}/u.test(token) ||
        (/^\p{Lu}/u.test(token) && !sentenceStart && token !== 'I'),
    }
  })
  return runsOf(words)
    .filter((run) => run.some(({ identifying }) => identifying))
    .map((run) => run.map(({ word }) => word).join(' '))
}

// Split before lowercasing, as the source side does: lowercasing "İ" adds a
// combining mark, which would split one word in two on this side only.
const draftRuns = (text: string): string[] =>
  runsOf(
    [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((match) =>
      match[0].toLowerCase(),
    ),
  ).map((run) => run.join(' '))

export const checkCopiedText = (
  fields: string[],
  sourceTexts: string[],
): string | undefined => {
  const source = new Set(sourceTexts.flatMap(identifyingSourceRuns))
  if (source.size === 0) return undefined
  return fields.some((field) => draftRuns(field).some((run) => source.has(run)))
    ? 'an 8-word run copied from the session, with a number or a ' +
        'mid-sentence capital in it, appeared in the draft'
    : undefined
}

export const checkContactPatterns = (fields: string[]): string | undefined => {
  const text = fields.join(' ')
  if (
    [...text.matchAll(EMAILS)].some(
      (match) => !isExampleHost(emailHost(text, match)),
    )
  ) {
    return 'an email address appeared in a case field'
  }
  if (PHONE.test(text) || [...text.matchAll(LOCAL_PHONE)].some(isLocalPhone)) {
    return 'a phone number appeared in a case field'
  }
  if (
    [...text.matchAll(URL_PATTERN)].some((match) => {
      const host = urlHost(match[0])
      return host === undefined || !isExampleHost(host)
    })
  ) {
    return 'a URL appeared in a case field'
  }
  return undefined
}

// An unreadable answer is retried once and then blocks the draft.
const readFlagged = (raw: string) => {
  try {
    return SecondReadResponseSchema.parse(extractJsonArray(raw))
  } catch {
    return undefined
  }
}

type LayerFailure = { reason: string; flagged?: string[] }

const failure = (reason: string | undefined): LayerFailure | undefined =>
  reason === undefined ? undefined : { reason }

// Compares the draft with the real chat and blocks only on what came from it;
// never sees the denylist. Fails closed: a call error or an answer still
// unreadable after one retry blocks.
export const runSecondRead = async (
  fields: string[],
  sourceTexts: string[],
  call: SecondReadCall,
): Promise<LayerFailure | undefined> => {
  const draftText = fields.join('\n')
  const sourceText = sourceTexts.join('\n---\n')
  for (let attempt = 1; ; attempt++) {
    let raw: string
    try {
      raw = await call(draftText, sourceText)
    } catch (err) {
      if (err instanceof SecondReadCallError) {
        return { reason: 'the second read call failed' }
      }
      throw err
    }
    const flagged = readFlagged(raw)
    if (flagged !== undefined) {
      return flagged.length > 0
        ? {
            reason: 'the second read flagged a detail from the real chat',
            flagged: flagged.map((item) =>
              typeof item === 'string' ? item : JSON.stringify(item),
            ),
          }
        : undefined
    }
    if (attempt >= SECOND_READ_MAX_ATTEMPTS) {
      return {
        reason: 'the second read returned an unparseable answer after a retry',
      }
    }
  }
}

export const validateAgainstSchema = (
  candidate: CaseCandidate,
): string | undefined => {
  const result = DraftedCaseSchema.safeParse(candidate)
  return result.success
    ? undefined
    : (result.error.issues[0]?.message ?? 'schema validation failed')
}

const gateStrings = async (
  fields: string[],
  denylist: string[],
  sourceTexts: string[],
  secondRead: SecondReadCall,
  schema?: () => string | undefined,
): Promise<GateResult> => {
  const layers: Array<[GateRule, () => Promise<LayerFailure | undefined>]> = [
    ['denylist', async () => failure(checkDenylist(fields, denylist))],
    ['copiedText', async () => failure(checkCopiedText(fields, sourceTexts))],
    ['contactPattern', async () => failure(checkContactPatterns(fields))],
    ['secondRead', () => runSecondRead(fields, sourceTexts, secondRead)],
  ]
  if (schema) layers.push(['schema', async () => failure(schema())])
  for (const [rule, check] of layers) {
    const result = await check()
    if (result !== undefined) return { passed: false, rule, ...result }
  }
  return { passed: true }
}

export const gateDraft = (
  draft: CaseCandidate,
  denylist: string[],
  sourceTexts: string[],
  secondRead: SecondReadCall,
): Promise<GateResult> =>
  gateStrings(
    outboundStrings({ case: draft }),
    denylist,
    sourceTexts,
    secondRead,
    () => validateAgainstSchema(draft),
  )

// The text layers only: a needs-setup line has no case schema.
export const gateNeedsSetup = (
  what: string,
  denylist: string[],
  sourceTexts: string[],
  secondRead: SecondReadCall,
): Promise<GateResult> =>
  gateStrings(
    outboundStrings({ needsSetup: what }),
    denylist,
    sourceTexts,
    secondRead,
  )
