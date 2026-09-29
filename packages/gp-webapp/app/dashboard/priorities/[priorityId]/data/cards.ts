import {
  ConstituentRefSchema,
  OutsideContactSchema,
  OutreachProposalSchema,
  PastOutreachRefSchema,
  mintProposalKey,
  type ChatCard,
} from '@goodparty_org/contracts'

// The tools whose call IS a card. They do no work server-side; the whole
// point of the call is what it leaves in the conversation.
export const CARD_TOOLS = [
  'present_outreach_proposal',
  'present_constituents',
  // The name present_constituents shipped under. Segments that already exist
  // on dev and prod persist it, so it stays mapped forever.
  'present_contacts',
  'present_outside_contact',
  'present_past_outreach',
  'read_past_outreach',
] as const

export const isCardTool = (toolName: string): boolean =>
  (CARD_TOOLS as readonly string[]).includes(toolName)

// The model never writes proposalKey, so the card's args carry everything but.
const OutreachProposalArgsSchema = OutreachProposalSchema.omit({
  proposalKey: true,
})

/**
 * A tool call rendered as a card, or null when it is not one.
 *
 * Args that don't parse drop the card and leave the turn's prose alone, the
 * same policy the ordinance widgets use. `read_past_outreach` is a data read
 * whose args are `{ channel? }`, so it always takes that path and falls
 * through to an ordinary tool pill; `present_past_outreach` is the presenter
 * that actually carries a card.
 */
export const toChatCard = ({
  toolName,
  args,
  toolCallId,
  conversationId,
}: {
  toolName: string
  args: unknown
  toolCallId: string | null | undefined
  conversationId: string
}): ChatCard | null => {
  switch (toolName) {
    case 'present_outreach_proposal': {
      const parsed = OutreachProposalArgsSchema.safeParse(args)
      // Without the tool call id there is no key the server would agree with,
      // and a proposal keyed on a guess would send under the wrong id.
      if (!parsed.success || !toolCallId) return null
      return {
        kind: 'outreach_proposal',
        ...parsed.data,
        // Derived, never taken from the model. A card renders from the tool
        // ARGS, so a model that writes `deepLinkOnly: false` on a social
        // proposal would otherwise put a Send button on something that
        // cannot be sent: social carries no platform in this contract, and
        // text lands behind Stripe, where Send would leave an unpaid draft.
        deepLinkOnly: parsed.data.channel !== 'phoneBanking',
        proposalKey: mintProposalKey(conversationId, toolCallId),
      }
    }
    case 'present_constituents':
    case 'present_contacts': {
      const parsed = ConstituentRefSchema.safeParse(args)
      return parsed.success ? { kind: 'constituents', ...parsed.data } : null
    }
    case 'present_outside_contact': {
      const parsed = OutsideContactSchema.safeParse(args)
      return parsed.success ? { kind: 'outside_contact', ...parsed.data } : null
    }
    case 'present_past_outreach':
    case 'read_past_outreach': {
      const parsed = PastOutreachRefSchema.safeParse(args)
      return parsed.success ? { kind: 'past_outreach', ...parsed.data } : null
    }
    default:
      return null
  }
}
