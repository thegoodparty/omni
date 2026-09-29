import { describe, expect, it } from 'vitest'
import { mintProposalKey } from '@goodparty_org/contracts'
import { toChatCard } from './cards'

const CONVERSATION_ID = 'conv_abc'
const TOOL_CALL_ID = 'toolu_01xyz'

const proposalArgs = {
  audience: 'Households on the Maple Street route',
  count: 412,
  channel: 'phoneBanking',
  message: 'Calling about the repaving schedule.',
  why: 'They are the ones the closure affects.',
}

describe('toChatCard', () => {
  it('derives proposalKey with mintProposalKey rather than reading it off args', () => {
    const card = toChatCard({
      toolName: 'present_outreach_proposal',
      // The model writing a key must not win — the derived one is the truth.
      args: { ...proposalArgs, proposalKey: 'a-key-the-model-made-up' },
      toolCallId: TOOL_CALL_ID,
      conversationId: CONVERSATION_ID,
    })
    expect(card).not.toBeNull()
    expect(card && 'proposalKey' in card && card.proposalKey).toBe(
      mintProposalKey(CONVERSATION_ID, TOOL_CALL_ID),
    )
  })

  it('derives the same key on every render', () => {
    const args = {
      toolName: 'present_outreach_proposal',
      args: proposalArgs,
      toolCallId: TOOL_CALL_ID,
      conversationId: CONVERSATION_ID,
    }
    expect(toChatCard(args)).toEqual(toChatCard(args))
  })

  it('drops a proposal with no tool call id rather than guessing a key', () => {
    expect(
      toChatCard({
        toolName: 'present_outreach_proposal',
        args: proposalArgs,
        toolCallId: null,
        conversationId: CONVERSATION_ID,
      }),
    ).toBeNull()
  })

  it('maps present_contacts', () => {
    expect(
      toChatCard({
        toolName: 'present_contacts',
        args: { contactIds: ['c1', 'c2'], note: 'They run the food bank.' },
        toolCallId: TOOL_CALL_ID,
        conversationId: CONVERSATION_ID,
      }),
    ).toEqual({
      kind: 'contacts',
      contactIds: ['c1', 'c2'],
      note: 'They run the food bank.',
    })
  })

  it('drops read_past_outreach, whose args are a query and not a card', () => {
    expect(
      toChatCard({
        toolName: 'read_past_outreach',
        args: { channel: 'sms' },
        toolCallId: TOOL_CALL_ID,
        conversationId: CONVERSATION_ID,
      }),
    ).toBeNull()
  })

  it('forces deepLinkOnly on a channel that cannot be sent from a card', () => {
    const social = toChatCard({
      toolName: 'present_outreach_proposal',
      // The model claiming it is sendable must not win.
      args: { ...proposalArgs, channel: 'social', deepLinkOnly: false },
      toolCallId: TOOL_CALL_ID,
      conversationId: CONVERSATION_ID,
    })
    expect(social && 'deepLinkOnly' in social && social.deepLinkOnly).toBe(true)

    const text = toChatCard({
      toolName: 'present_outreach_proposal',
      args: { ...proposalArgs, channel: 'text', deepLinkOnly: false },
      toolCallId: TOOL_CALL_ID,
      conversationId: CONVERSATION_ID,
    })
    expect(text && 'deepLinkOnly' in text && text.deepLinkOnly).toBe(true)

    const phone = toChatCard({
      toolName: 'present_outreach_proposal',
      args: { ...proposalArgs, channel: 'phoneBanking' },
      toolCallId: TOOL_CALL_ID,
      conversationId: CONVERSATION_ID,
    })
    expect(phone && 'deepLinkOnly' in phone && phone.deepLinkOnly).toBe(false)
  })

  it('maps present_past_outreach', () => {
    expect(
      toChatCard({
        toolName: 'present_past_outreach',
        args: { outreachIds: [7, 9], note: 'Both landed in March.' },
        toolCallId: TOOL_CALL_ID,
        conversationId: CONVERSATION_ID,
      }),
    ).toEqual({
      kind: 'past_outreach',
      outreachIds: [7, 9],
      note: 'Both landed in March.',
    })
  })

  it('returns null for a tool that is not a card', () => {
    expect(
      toChatCard({
        toolName: 'count_contacts',
        args: {},
        toolCallId: TOOL_CALL_ID,
        conversationId: CONVERSATION_ID,
      }),
    ).toBeNull()
  })
})
