import { describe, expect, it } from 'vitest'
import { ChatScope } from '../../../generated/prisma'
import { LEGAL_LINE } from '@/chats/general/campaign-manager/campaignManagerPrompt'
import { COS_GUARDRAIL_DECLINE } from '@/chats/general/chief-of-staff/services/chiefOfStaffPrompt'
import lines from './guardrailLines.json'
import {
  GUARDRAIL_CHATS,
  GUARDRAIL_IDS,
  GuardrailChat,
  GuardrailId,
  guardrailChatForScope,
  guardrailLine,
  tryGuardrailLine,
} from './guardrailLines'
import { PROFESSIONAL_ADVICE_DISCLAIMER } from './professionalAdviceCheck'

// Which chats the bench assigns each guardrail to. Every pair listed here
// must resolve; the module and the bench registry name the same ids and chats.
const ASSIGNMENTS: Record<GuardrailId, readonly GuardrailChat[]> = {
  scope_decline: GUARDRAIL_CHATS,
  election_rule_verify: ['campaign_assistant'],
  search_provenance: ['campaign_assistant'],
  handoff_draft: ['chief_of_staff'],
  legal_advice: GUARDRAIL_CHATS,
  professional_advice: GUARDRAIL_CHATS,
  small_count: GUARDRAIL_CHATS,
}

describe('guardrailLine', () => {
  it('resolves a chat variant before the chat and the default', () => {
    expect(guardrailLine('scope_decline', 'ordinance_flow', 'bill')).toBe(
      lines.scope_decline['ordinance_flow.bill'],
    )
    expect(guardrailLine('scope_decline', 'ordinance_flow', 'municipal')).toBe(
      lines.scope_decline['ordinance_flow.municipal'],
    )
  })

  it('resolves a chat key before the default', () => {
    expect(guardrailLine('legal_advice', 'campaign_assistant')).toBe(
      lines.legal_advice.campaign_assistant,
    )
  })

  it('falls back to the default when the chat has no entry of its own', () => {
    expect(guardrailLine('legal_advice', 'briefing_chat')).toBe(
      lines.legal_advice.default,
    )
    expect(guardrailLine('legal_advice', 'ordinance_flow', 'bill')).toBe(
      lines.legal_advice.default,
    )
  })

  it('throws when a guardrail has no line for the chat', () => {
    expect(() => guardrailLine('handoff_draft', 'campaign_assistant')).toThrow(
      /no guardrail line for handoff_draft on campaign_assistant/,
    )
    expect(() => guardrailLine('scope_decline', 'ordinance_flow')).toThrow(
      /ordinance_flow/,
    )
  })

  it('resolves every chat the bench assigns a guardrail to', () => {
    for (const id of GUARDRAIL_IDS) {
      for (const chat of ASSIGNMENTS[id]) {
        if (chat === 'ordinance_flow') {
          expect(guardrailLine(id, chat, 'municipal')).not.toBe('')
          expect(guardrailLine(id, chat, 'bill')).not.toBe('')
        } else {
          expect(guardrailLine(id, chat)).not.toBe('')
        }
      }
    }
  })
})

describe('tryGuardrailLine', () => {
  it('returns null instead of throwing for a chat without the line', () => {
    expect(tryGuardrailLine('handoff_draft', 'campaign_assistant')).toBeNull()
    expect(tryGuardrailLine('handoff_draft', 'chief_of_staff')).toBe(
      lines.handoff_draft.chief_of_staff,
    )
  })
})

describe('guardrailChatForScope', () => {
  it('maps the four chat scopes to their bench names and the rest to null', () => {
    expect(guardrailChatForScope(ChatScope.campaign_assistant)).toBe(
      'campaign_assistant',
    )
    expect(guardrailChatForScope(ChatScope.briefing_annotation)).toBe(
      'briefing_chat',
    )
    expect(guardrailChatForScope(ChatScope.priority_flow)).toBeNull()
  })
})

describe('guardrailLines.json', () => {
  // The bench reads these keys at a pinned commit, so a rename breaks it.
  it('keeps the scope decline keyed by every chat and ordinance variant', () => {
    expect(Object.keys(lines.scope_decline).sort()).toEqual([
      'briefing_chat',
      'campaign_assistant',
      'chief_of_staff',
      'ordinance_flow.bill',
      'ordinance_flow.municipal',
    ])
  })

  it('holds only known ids and chat keys, with trimmed non-empty text', () => {
    const chatKey =
      /^(campaign_assistant|chief_of_staff|briefing_chat|ordinance_flow\.(municipal|bill)|default)$/
    for (const [id, entry] of Object.entries(lines)) {
      expect(GUARDRAIL_IDS).toContain(id)
      for (const [key, text] of Object.entries(entry)) {
        expect(key).toMatch(chatKey)
        expect(text.trim()).toBe(text)
        expect(text.length).toBeGreaterThan(0)
      }
    }
  })

  // Prompts that still inline their line are held equal to the file here, so
  // the file and production cannot drift before each chat adopts the module.
  it('matches every line production says today, byte for byte', () => {
    expect(guardrailLine('scope_decline', 'chief_of_staff')).toBe(
      COS_GUARDRAIL_DECLINE,
    )
    expect(guardrailLine('legal_advice', 'campaign_assistant')).toBe(LEGAL_LINE)
    expect(guardrailLine('professional_advice', 'chief_of_staff')).toBe(
      PROFESSIONAL_ADVICE_DISCLAIMER,
    )
  })
})
