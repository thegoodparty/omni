import {
  ConstituentRefSchema,
  OutsideContactSchema,
  OutreachProposalSchema,
  PastOutreachRefSchema,
  mintProposalKey,
  type ChatCard,
} from '@goodparty_org/contracts'
import type { OutreachLaunchSource } from 'app/dashboard/outreach/util/outreachAnalytics'
import type { WidgetToolCall } from '../widgetRegistry'
import { defineWidgetTool } from '../widgetRegistry'
import { ConstituentsCard } from './ConstituentsCard'
import { OutreachProposalCard } from './OutreachProposalCard'
import { OutsideContactCard } from './OutsideContactCard'
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
const cardDetailKey = (call: WidgetToolCall): { detailKey?: string } => {
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

const parseConstituents = (
  args: unknown,
): Extract<ChatCard, { kind: 'constituents' }> | null => {
  const parsed = ConstituentRefSchema.safeParse(args)
  return parsed.success ? { kind: 'constituents', ...parsed.data } : null
}

const renderConstituents = (
  card: Extract<ChatCard, { kind: 'constituents' }>,
  _ctx: CardWidgetContext,
  call: WidgetToolCall,
) => <ConstituentsCard card={card} {...cardDetailKey(call)} />

const parsePastOutreach = (
  args: unknown,
): Extract<ChatCard, { kind: 'past_outreach' }> | null => {
  const parsed = PastOutreachRefSchema.safeParse(args)
  return parsed.success ? { kind: 'past_outreach', ...parsed.data } : null
}

const renderPastOutreach = (
  card: Extract<ChatCard, { kind: 'past_outreach' }>,
) => <PastOutreachCard card={card} />

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
  defineWidgetTool({
    toolName: 'present_constituents',
    parse: parseConstituents,
    render: renderConstituents,
  }),
  // The name present_constituents shipped under. Segments that already exist
  // on dev and prod persist it, so it stays mapped forever.
  defineWidgetTool({
    toolName: 'present_contacts',
    parse: parseConstituents,
    render: renderConstituents,
  }),
  defineWidgetTool({
    toolName: 'present_outside_contact',
    parse: (args) => {
      const parsed = OutsideContactSchema.safeParse(args)
      return parsed.success
        ? { kind: 'outside_contact' as const, ...parsed.data }
        : null
    },
    render: (card, _ctx: CardWidgetContext, call) => (
      <OutsideContactCard card={card} {...cardDetailKey(call)} />
    ),
  }),
  defineWidgetTool({
    toolName: 'present_past_outreach',
    parse: parsePastOutreach,
    render: renderPastOutreach,
  }),
  // A data read whose args are `{ channel? }`, so it never parses and stays an
  // ordinary tool pill; present_past_outreach is the call that carries a card.
  defineWidgetTool({
    toolName: 'read_past_outreach',
    parse: parsePastOutreach,
    render: renderPastOutreach,
    onParseFailure: 'inline',
  }),
]
