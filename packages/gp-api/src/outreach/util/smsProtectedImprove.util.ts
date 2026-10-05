import { type LlmMessage } from '@/llm/types/llmMessages.types'

// What the mask needs of a locked part, so an SMS part and a robocall part
// (contracts' deriveSmsProtectedParts and deriveRobocallProtectedParts) both
// fit. A token is masked everywhere it appears; a phrase where it starts.
interface MaskablePart {
  kind: 'token' | 'phrase'
  text: string
  start?: number
}

// Improve rewrites a message that, since the composer locks its required
// parts (docs/features/message-composer.md), contains text the model must
// never change: the candidate's name, the paid-for-by disclaimer, the opt-out
// line, the merge tag. So the model never sees them. Each is swapped for a
// numbered marker before the call, and the reply is accepted only if every
// marker comes back exactly once and in order, at which point the original
// text goes back in.

const markerFor = (index: number): string => `⟦${index + 1}⟧`
const MARKER_PATTERN = /⟦(\d+)⟧/g
const WORD_CHARACTER = /[\p{L}\p{N}]/u

// The same rule TokenField uses to anchor a locked phrase: a phrase that
// starts or ends in a letter is never cut out of a longer word.
const splitsWord = (script: string, start: number, end: number): boolean => {
  const isWord = (char: string | undefined) =>
    char !== undefined && WORD_CHARACTER.test(char)
  const text = script.slice(start, end)
  return (
    (isWord(text[0]) && isWord(script[start - 1])) ||
    (isWord(text[text.length - 1]) && isWord(script[end]))
  )
}

interface Span {
  start: number
  end: number
}

const overlaps = (a: Span, b: Span) => a.start < b.end && a.end > b.start

// Where each locked part sits in the script. A phrase sits where
// deriveSmsProtectedParts found it: the same words can appear twice (a body
// quoting the opt-out line), and only the copy it chose is the locked one.
// Longest first, so a name inside the disclaimer cannot claim the
// disclaimer's characters; a merge tag takes every occurrence.
const locate = (script: string, parts: MaskablePart[]): Span[] => {
  const spans: Span[] = []
  const byLength = [...parts].sort((a, b) => b.text.length - a.text.length)
  for (const part of byLength) {
    if (part.kind === 'phrase' && part.start !== undefined) {
      const span = { start: part.start, end: part.start + part.text.length }
      const placed =
        script.slice(span.start, span.end) === part.text &&
        !spans.some((other) => overlaps(span, other))
      if (placed) {
        spans.push(span)
        continue
      }
    }
    let from = 0
    for (;;) {
      const start = script.indexOf(part.text, from)
      if (start === -1) break
      const span = { start, end: start + part.text.length }
      const free =
        !splitsWord(script, span.start, span.end) &&
        !spans.some((other) => overlaps(span, other))
      if (free) {
        spans.push(span)
        if (part.kind === 'phrase') break
      }
      from = start + 1
    }
  }
  return spans.sort((a, b) => a.start - b.start)
}

export interface MaskedScript {
  masked: string
  // The original text of each marker, in marker order.
  locked: string[]
}

export const maskProtectedParts = (
  script: string,
  parts: MaskablePart[],
): MaskedScript => {
  const spans = locate(script, parts)
  let masked = ''
  let cursor = 0
  const locked: string[] = []
  spans.forEach((span, index) => {
    masked += script.slice(cursor, span.start) + markerFor(index)
    locked.push(script.slice(span.start, span.end))
    cursor = span.end
  })
  return { masked: masked + script.slice(cursor), locked }
}

const markerList = (numbers: number[]): string =>
  numbers.length === 0
    ? 'no markers at all'
    : numbers.map((number) => markerFor(number - 1)).join(' ')

// Null when the reply carries every marker exactly once, in order, and no
// marker it was not given. Otherwise a sentence naming what came back and
// what should have, for the retry turn and for the log line: it is the one
// question an operator asks when a polish is refused, and the markers are
// positions, never the locked text itself, so it is safe to log.
export const describeMarkerMiss = (
  reply: string,
  locked: string[],
): string | null => {
  const seen = [...reply.matchAll(MARKER_PATTERN)].map((match) =>
    Number(match[1]),
  )
  const expected = locked.map((_, index) => index + 1)
  if (
    seen.length === expected.length &&
    seen.every((number, index) => number === expected[index])
  ) {
    return null
  }
  return (
    `it came back with ${markerList(seen)}, where it has to carry ` +
    `${markerList(expected)} — each exactly once, in that order, with ` +
    'none added'
  )
}

// Null unless the reply carries every marker exactly once, in order, and no
// marker it was not given. Anything else means the model moved, dropped,
// duplicated or invented locked text, and none of it is safe to send.
export const restoreProtectedParts = (
  reply: string,
  locked: string[],
): string | null => {
  if (describeMarkerMiss(reply, locked) !== null) {
    return null
  }
  return reply.replace(
    MARKER_PATTERN,
    (_, number: string) => locked[Number(number) - 1] ?? '',
  )
}

// The improve prompts' rule for the markers, shared by Win and Serve.
export const PROTECTED_MARKER_RULE = [
  '- The message contains markers like ⟦1⟧. Each stands for required text',
  '  you cannot see and must not change. Keep every marker exactly once,',
  '  in the same order, and never add one. You may change the words',
  '  before, between and after them. Do NOT add opt-out or paid-for-by',
  '  language: the markers already hold it.',
].join('\n')

// A refused reply goes back to the model with what was wrong with it, so the
// next attempt is a correction and not another roll of the same dice. Sending
// the first prompt again unchanged is what turned one unlucky reply into a
// failed Improve for a candidate (incident 107): the model was never told it
// had dropped a marker, so its second answer was as likely to drop one as
// its first. The rejected draft is quoted back as the model's own turn, where
// it has no more authority than the text it already wrote.
export const improveCorrectionTurns = (
  rejected: string,
  problem: string,
): LlmMessage[] => [
  { role: 'assistant', content: rejected },
  {
    role: 'user',
    content: [
      `That version cannot be used: ${problem}.`,
      'Send the polished message again. Fix only that, keep the rest of',
      'your wording, and change nothing else.',
    ].join('\n'),
  },
]
