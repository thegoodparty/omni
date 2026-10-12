// The one source for every runtime guardrail line the chat assistants say.
// Prompts and finish-time backstops read a line from here instead of
// inlining a copy, and the chat bench reads guardrailLines.json at a pinned
// commit, so the text an assistant is asked to write and the text the bench
// checks for cannot drift apart.
//
// A line production already says is quoted here exactly, and a test holds
// the two equal until the prompt reads it from here. The rest are proposals
// nothing says yet; each chat adopts them in its own change.
//
// Keys inside each guardrail: "<chat>.<variant>", "<chat>", or "default",
// tried in that order. The chat names are the bench's names, not ChatScope
// values: the briefing chat has no scope of its own.
import { ChatScope } from '../../../generated/prisma'
import lines from './guardrailLines.json'

export const GUARDRAIL_IDS = [
  'scope_decline',
  'election_rule_verify',
  'search_provenance',
  'handoff_draft',
  'legal_advice',
  'professional_advice',
  'small_count',
] as const
export type GuardrailId = (typeof GUARDRAIL_IDS)[number]

export const GUARDRAIL_CHATS = [
  'campaign_assistant',
  'chief_of_staff',
  'ordinance_flow',
  'briefing_chat',
] as const
export type GuardrailChat = (typeof GUARDRAIL_CHATS)[number]

export type GuardrailVariant = 'municipal' | 'bill'

// Typed by id so the compiler rejects a JSON file missing a guardrail; the
// test rejects one that adds an unknown one.
const table: Record<GuardrailId, { [key: string]: string }> = lines

export const tryGuardrailLine = (
  id: GuardrailId,
  chat: GuardrailChat,
  variant?: GuardrailVariant,
): string | null => {
  const entry = table[id]
  const keys = variant
    ? [`${chat}.${variant}`, chat, 'default']
    : [chat, 'default']
  for (const key of keys) {
    const text = entry[key]
    if (text) return text
  }
  return null
}

// Prompts resolve their lines at module load, so a missing line fails at
// boot, where it belongs, rather than on a user's turn.
export const guardrailLine = (
  id: GuardrailId,
  chat: GuardrailChat,
  variant?: GuardrailVariant,
): string => {
  const text = tryGuardrailLine(id, chat, variant)
  if (text === null) {
    throw new Error(
      `no guardrail line for ${id} on ${chat}${variant ? `.${variant}` : ''}`,
    )
  }
  return text
}

const CHAT_BY_SCOPE: Partial<Record<ChatScope, GuardrailChat>> = {
  [ChatScope.campaign_assistant]: 'campaign_assistant',
  [ChatScope.chief_of_staff]: 'chief_of_staff',
  [ChatScope.ordinance_flow]: 'ordinance_flow',
  [ChatScope.briefing_annotation]: 'briefing_chat',
}

export const guardrailChatForScope = (scope: ChatScope): GuardrailChat | null =>
  CHAT_BY_SCOPE[scope] ?? null
