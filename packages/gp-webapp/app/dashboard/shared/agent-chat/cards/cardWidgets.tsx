import {
  OutreachProposalSchema,
  PastOutreachRefSchema,
  mintProposalKey,
  type ChatCard,
} from '@goodparty_org/contracts'
import type { OutreachLaunchSource } from 'app/dashboard/outreach/util/outreachAnalytics'
import type { WidgetToolCall } from '../widgetRegistry'
import { defineWidgetTool } from '../widgetRegistry'
import { OutreachProposalCard } from './OutreachProposalCard'
import { PastOutreachCard } from './PastOutreachCard'

export type CardWidgetContext = {
  // Absent outside a priority: an outreach handoff then links to no priority.
  priorityId?: string
  // What launched an outreach card opened from this turn, when the surface
  // knows better than the flows' default.
  launchSource?: OutreachLaunchSource
}

// Which detail a card opens. The live and the persisted copy of one tool call
// share it, so a panel opened mid-turn stays open across the swap: the tool
// call id when there is one, because the live turn has no message row yet;
// the segment position otherwise, which is stable on reload.
export const cardDetailKey = (call: WidgetToolCall): { detailKey?: string } => {
  if (call.toolCallId) return { detailKey: `call:${call.toolCallId}` }
  if (call.messageId !== null && call.segmentIndex !== null) {
    return { detailKey: `segment:${call.messageId}:${call.segmentIndex}` }
  }
  return {}
}

// The model never writes proposalKey, so the card's args carry everything but.
const OutreachProposalArgsSchema = OutreachProposalSchema.omit({
  proposalKey: true,
})

// Args that don't parse drop the card and leave the turn's prose alone.
export const parseOutreachProposal = (
  args: unknown,
  call: Pick<WidgetToolCall, 'conversationId' | 'toolCallId'>,
): Extract<ChatCard, { kind: 'outreach_proposal' }> | null => {
  const parsed = OutreachProposalArgsSchema.safeParse(args)
  // Without the tool call id there is no key the server would agree with,
  // and a proposal keyed on a guess would send under the wrong id.
  if (!parsed.success || !call.toolCallId) return null
  return {
    kind: 'outreach_proposal',
    ...parsed.data,
    // Derived, never taken from the model. A card renders from the tool
    // ARGS, so a model that writes `deepLinkOnly: false` on a social
    // proposal would otherwise put a Send button on something that
    // cannot be sent: social carries no platform in this contract, and
    // text lands behind Stripe, where Send would leave an unpaid draft.
    deepLinkOnly: parsed.data.channel !== 'phoneBanking',
    proposalKey: mintProposalKey(call.conversationId ?? '', call.toolCallId),
  }
}

export const cardWidgetTools = [
  defineWidgetTool({
    toolName: 'present_outreach_proposal',
    parse: parseOutreachProposal,
    render: (proposal, { priorityId, launchSource }: CardWidgetContext) => (
      <OutreachProposalCard
        proposal={proposal}
        {...(priorityId !== undefined && { priorityId })}
        {...(launchSource !== undefined && { launchSource })}
      />
    ),
  }),
  // A data read whose args are `{ channel? }`, so it never parses and stays an
  // ordinary tool pill; present_card's past_outreach kind carries the card.
  defineWidgetTool({
    toolName: 'read_past_outreach',
    parse: (args): Extract<ChatCard, { kind: 'past_outreach' }> | null => {
      const parsed = PastOutreachRefSchema.safeParse(args)
      return parsed.success ? { kind: 'past_outreach', ...parsed.data } : null
    },
    render: (card) => <PastOutreachCard card={card} />,
    onParseFailure: 'inline',
  }),
]
