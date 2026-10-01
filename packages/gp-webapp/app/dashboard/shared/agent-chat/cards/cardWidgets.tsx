import type { WidgetToolCall } from '../widgetRegistry'
import { defineWidgetTool } from '../widgetRegistry'
import { ChatCardRenderer } from './ChatCardRenderer'
import { toChatCard } from './toChatCard'

// The tool call id when there is one, because the live turn has no message
// row yet; the segment position otherwise, which is stable on reload.
const cardDetailKey = (call: WidgetToolCall): string | undefined => {
  if (call.toolCallId) return `call:${call.toolCallId}`
  if (call.messageId !== null && call.segmentIndex !== null) {
    return `segment:${call.messageId}:${call.segmentIndex}`
  }
  return undefined
}

const cardTool = (toolName: string, onParseFailure?: 'inline') =>
  defineWidgetTool({
    toolName,
    parse: (args, call: WidgetToolCall) =>
      toChatCard({
        toolName,
        args,
        toolCallId: call.toolCallId,
        conversationId: call.conversationId ?? '',
      }),
    // Cards read nothing from the surface: everything they need is in the
    // call, so any surface's context fits.
    render: (card, _ctx: object, call) => {
      const detailKey = cardDetailKey(call)
      return (
        <ChatCardRenderer
          card={card}
          {...(detailKey !== undefined && { detailKey })}
        />
      )
    },
    ...(onParseFailure && { onParseFailure }),
  })

export const cardWidgetTools = [
  cardTool('present_outreach_proposal'),
  cardTool('present_constituents'),
  // The name present_constituents shipped under. Segments that already exist
  // on dev and prod persist it, so it stays mapped forever.
  cardTool('present_contacts'),
  cardTool('present_outside_contact'),
  cardTool('present_past_outreach'),
  // A data read whose args are `{ channel? }`, so it never parses and stays an
  // ordinary tool pill; present_past_outreach is the call that carries a card.
  cardTool('read_past_outreach', 'inline'),
]
