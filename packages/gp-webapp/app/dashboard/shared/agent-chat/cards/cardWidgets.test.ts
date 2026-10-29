import { describe, expect, it } from 'vitest'
import { mintProposalKey } from '@goodparty_org/contracts'
import { chatWidgets } from '../chatWidgets'
import { parseOutreachProposal } from './cardWidgets'

const CONVERSATION_ID = 'conv_abc'
const TOOL_CALL_ID = 'toolu_01xyz'
const CALL = { toolCallId: TOOL_CALL_ID, conversationId: CONVERSATION_ID }

const proposalArgs = {
  audience: 'Households on the Maple Street route',
  count: 412,
  channel: 'phoneBanking',
  message: 'Calling about the repaving schedule.',
  why: 'They are the ones the closure affects.',
}

const resolve = (toolName: string, args: unknown) =>
  chatWidgets.resolve({ toolName, ...CALL }, args)

describe('parseOutreachProposal', () => {
  it('derives proposalKey with mintProposalKey rather than reading it off args', () => {
    const card = parseOutreachProposal(
      // The model writing a key must not win — the derived one is the truth.
      { ...proposalArgs, proposalKey: 'a-key-the-model-made-up' },
      CALL,
    )
    expect(card).not.toBeNull()
    expect(card?.proposalKey).toBe(
      mintProposalKey(CONVERSATION_ID, TOOL_CALL_ID),
    )
  })

  it('derives the same key on every render', () => {
    expect(parseOutreachProposal(proposalArgs, CALL)).toEqual(
      parseOutreachProposal(proposalArgs, CALL),
    )
  })

  it('drops a proposal with no tool call id rather than guessing a key', () => {
    expect(
      parseOutreachProposal(proposalArgs, {
        toolCallId: null,
        conversationId: CONVERSATION_ID,
      }),
    ).toBeNull()
  })

  it('forces deepLinkOnly on a channel that cannot be sent from a card', () => {
    // The model claiming it is sendable must not win.
    for (const channel of ['social', 'text', 'doorKnocking']) {
      expect(
        parseOutreachProposal(
          { ...proposalArgs, channel, deepLinkOnly: false },
          CALL,
        )?.deepLinkOnly,
      ).toBe(true)
    }
    expect(
      parseOutreachProposal({ ...proposalArgs, channel: 'phoneBanking' }, CALL)
        ?.deepLinkOnly,
    ).toBe(false)
  })
})

describe('card widgets', () => {
  it('maps present_constituents and the legacy present_contacts', () => {
    // The old name is persisted on segments that already exist, so it has to
    // keep resolving after the rename.
    const args = { contactIds: ['c1', 'c2'], note: 'They run the food bank.' }
    expect(resolve('present_constituents', args)).not.toBeNull()
    expect(resolve('present_contacts', args)).not.toBeNull()
  })

  it('maps present_outside_contact', () => {
    expect(
      resolve('present_outside_contact', {
        name: "Dale County Attorney's Office",
        role: 'County attorney',
        why: 'They own the nuisance ordinance the complaints fall under.',
        askFor: 'The code enforcement division',
        script: 'Calling about 14 Mill St. Can you tell me who owns it?',
        phone: '(937) 555-0142',
        email: 'clerk@dalecounty.gov',
        url: 'https://dalecounty.gov/attorney',
      }),
    ).not.toBeNull()
  })

  it('drops a present_outside_contact whose url could run script', () => {
    expect(
      resolve('present_outside_contact', {
        name: 'County engineer',
        role: 'County engineer',
        why: 'They own the culvert.',
        askFor: 'The duty engineer',
        script: 'Calling about the culvert on Mill St.',
        url: 'javascript:alert(1)',
      }),
    ).toBeNull()
  })

  it('maps present_past_outreach', () => {
    expect(
      resolve('present_past_outreach', {
        outreachIds: [7, 9],
        note: 'Both landed in March.',
      }),
    ).not.toBeNull()
  })

  it('leaves read_past_outreach, whose args are a query, as a pill', () => {
    expect(resolve('read_past_outreach', { channel: 'sms' })).toBeNull()
    expect(chatWidgets.entry('read_past_outreach')?.onParseFailure).toBe(
      'inline',
    )
  })
})
