// Finish-time backstops for the runtime guardrails: pure functions over the
// assembled reply text and the turn's tool events, returning the line to
// append or null. They never edit what was streamed, because a stream cannot
// take text back; the only repair available at the end of a turn is to add a
// line that is missing.
//
// Two consequences shape them. A backstop appends a caution only when the
// reply carries none at all, so "one caution per reply" is enforced here and
// the choice between legal and professional stays with the prompt. And a
// backstop fires only on a deterministic signal (a statute mark, a tool
// result field, a tool call); judging whether prose is advice is the model's
// job. A chat that has no line for a guardrail gets null, never a throw: a
// throw inside the finish hook would drop every line for that turn.
import type { TurnToolEvent } from '@/chats/services/chatStream.service'
import { GuardrailChat, tryGuardrailLine } from './guardrailLines'
import { containsLine } from './normalizeLine'
import {
  ADVICE_SIGNALS,
  DISCLAIMER_PRESENT,
  SUBSTITUTE_OPENER,
} from './professionalAdviceCheck'

const HANDOFF_TOOL_NAME = 'compose_handoff'

const carriesLine = (
  text: string,
  id: 'legal_advice' | 'professional_advice',
  chat: GuardrailChat,
): boolean => {
  const line = tryGuardrailLine(id, chat)
  return line !== null && containsLine(text, line)
}

export const hasCautionLine = (text: string, chat: GuardrailChat): boolean =>
  DISCLAIMER_PRESENT.some((re) => re.test(text)) ||
  carriesLine(text, 'legal_advice', chat) ||
  carriesLine(text, 'professional_advice', chat)

// The strict test: only the canonical lines, or a sentence that opens the
// way they do, count as a caution. A chat whose model tends to close with a
// caution in its own words ("this is legal-risk analysis, not legal advice")
// uses this one, so the shared line still lands after the paraphrase.
export const hasCanonicalCautionLine = (
  text: string,
  chat: GuardrailChat,
): boolean =>
  SUBSTITUTE_OPENER.test(text) ||
  carriesLine(text, 'legal_advice', chat) ||
  carriesLine(text, 'professional_advice', chat)

export type CautionPresent = (text: string, chat: GuardrailChat) => boolean

// A chat may pass a narrower signal list when one of the shared signals is
// ordinary prose on that surface (the briefing chat quotes agenda material
// that cites code sections), and a stricter caution test when its model
// paraphrases the caution instead of giving the line; the shared list and
// the default test do not change.
export const legalAdviceBackstop = (
  text: string,
  chat: GuardrailChat,
  signals: readonly RegExp[] = ADVICE_SIGNALS,
  cautionPresent: CautionPresent = hasCautionLine,
): string | null => {
  if (!text.trim()) return null
  if (!signals.some((re) => re.test(text))) return null
  if (cautionPresent(text, chat)) return null
  return tryGuardrailLine('legal_advice', chat)
}

const suppressedRows = (event: TurnToolEvent): number => {
  if (event.status !== 'returned') return 0
  const result = event.result
  if (!result || typeof result !== 'object' || !('rowsSuppressed' in result)) {
    return 0
  }
  const value = result.rowsSuppressed
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export const smallCountBackstop = (
  text: string,
  chat: GuardrailChat,
  toolEvents: readonly TurnToolEvent[],
): string | null => {
  if (!toolEvents.some((event) => suppressedRows(event) > 0)) return null
  const line = tryGuardrailLine('small_count', chat)
  return line === null || containsLine(text, line) ? null : line
}

export const handoffDraftBackstop = (
  text: string,
  chat: GuardrailChat,
  toolEvents: readonly TurnToolEvent[],
): string | null => {
  const handedOff = toolEvents.some(
    (event) => event.name === HANDOFF_TOOL_NAME && event.status === 'returned',
  )
  if (!handedOff) return null
  const line = tryGuardrailLine('handoff_draft', chat)
  return line === null || containsLine(text, line) ? null : line
}

// Callers list the caution first, then the data note, then the handoff
// note: the caution is about the answer, the count note about the data behind
// it, and the handoff note about the drawer that just opened.
export const composeAppendix = (
  lines: ReadonlyArray<string | null>,
): string | null => {
  const kept = lines.filter(
    (line): line is string => typeof line === 'string' && line.trim() !== '',
  )
  return kept.length ? `\n\n${kept.join('\n\n')}` : null
}
