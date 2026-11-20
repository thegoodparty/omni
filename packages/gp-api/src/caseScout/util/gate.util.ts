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

// "Ordinance 245-2025" and "500-1000 voters" share a phone's shape. A year
// for a line, or a hyphenated rising pair of round numbers, reads as one of
// those instead.
const isLocalPhone = ([
  ,
  exchange = '',
  separator,
  line = '',
]: RegExpMatchArray) =>
  !YEAR.test(line) &&
  !(
    separator === '-' &&
    exchange.endsWith('0') &&
    line.endsWith('0') &&
    Number(line) > Number(exchange)
  )

const URL_PATTERN = new RegExp(
  String.raw`(?<!${WORD})(?:https?://|www\.)\S+`,
  'iu',
)

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

export type GateResult =
  | { passed: true }
  | { passed: false; rule: GateRule; reason: string }

// The second read failed to run at all (no answer to parse). Blocks at once,
// with no retry; an unparseable answer gets one retry instead.
export class SecondReadCallError extends Error {}

export type SecondReadCall = (draftText: string) => Promise<string>

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

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(new RegExp(String.raw`[^\p{L}\p{N}_\s]`, 'gu'), ' ')
    .replace(/\s+/gu, ' ')
    .trim()

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

const shingles = (text: string): Set<string> => {
  const words = text.split(/\s+/u).filter((word) => word !== '')
  const runs = new Set<string>()
  for (let i = 0; i + COPIED_TEXT_RUN_LENGTH <= words.length; i++) {
    runs.add(words.slice(i, i + COPIED_TEXT_RUN_LENGTH).join(' '))
  }
  return runs
}

export const checkCopiedText = (
  fields: string[],
  sourceTexts: string[],
): string | undefined => {
  const source = shingles(normalize(sourceTexts.join(' ')))
  if (source.size === 0) return undefined
  const draft = shingles(normalize(fields.join(' ')))
  return [...draft].some((run) => source.has(run))
    ? 'an 8-word run copied from the session appeared in the draft'
    : undefined
}

export const checkContactPatterns = (fields: string[]): string | undefined => {
  const text = fields.join(' ')
  if (EMAIL.test(text)) return 'an email address appeared in a case field'
  if (PHONE.test(text) || [...text.matchAll(LOCAL_PHONE)].some(isLocalPhone)) {
    return 'a phone number appeared in a case field'
  }
  if (URL_PATTERN.test(text)) return 'a URL appeared in a case field'
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

// Sees only the draft, never the transcript or the denylist, and fails
// closed: a call error or an answer still unreadable after one retry blocks.
export const runSecondRead = async (
  fields: string[],
  call: SecondReadCall,
): Promise<string | undefined> => {
  const draftText = fields.join('\n')
  for (let attempt = 1; ; attempt++) {
    let raw: string
    try {
      raw = await call(draftText)
    } catch (err) {
      if (err instanceof SecondReadCallError) {
        return 'the second read call failed'
      }
      throw err
    }
    const flagged = readFlagged(raw)
    if (flagged !== undefined) {
      return flagged.length > 0
        ? 'the second read flagged a likely real identifier'
        : undefined
    }
    if (attempt >= SECOND_READ_MAX_ATTEMPTS) {
      return 'the second read returned an unparseable answer after a retry'
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
  const layers: Array<[GateRule, () => Promise<string | undefined>]> = [
    ['denylist', async () => checkDenylist(fields, denylist)],
    ['copiedText', async () => checkCopiedText(fields, sourceTexts)],
    ['contactPattern', async () => checkContactPatterns(fields)],
    ['secondRead', () => runSecondRead(fields, secondRead)],
  ]
  if (schema) layers.push(['schema', async () => schema()])
  for (const [rule, check] of layers) {
    const reason = await check()
    if (reason !== undefined) return { passed: false, rule, reason }
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
