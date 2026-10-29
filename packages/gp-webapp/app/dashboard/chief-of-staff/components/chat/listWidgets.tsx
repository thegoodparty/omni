import {
  ListProposalSchema,
  mintProposalKey,
  ShowListMapSchema,
  type ShowListMap,
} from '@goodparty_org/contracts'
import { defineWidgetTool } from '../../../shared/agent-chat/widgetRegistry'
import type { CardMode } from '../../../shared/agent-chat/cards/proposalPresentation'
import ChatListMap from './ChatListMap'
import ChatListProposal from './ChatListProposal'

export const LIST_MAP_TOOL = 'show_list_map'
export const LIST_PROPOSAL_TOOL = 'present_list_proposal'

export type ListWidgetContext = {
  // Campaign Manager is Win: voters, and a Pro gate on saving a list.
  cardMode?: CardMode
  // Absent while the drawing surface is open for any list, so no other card
  // can remount it and discard the ring being drawn.
  onRefineArea?: (list: ShowListMap) => void
  onListCreated?: (list: ShowListMap) => void
}

// Both render after the turn's prose, once per turn. The proposal shares the
// map's place because once its list is created the card becomes that map.
export const listWidgetTools = [
  defineWidgetTool({
    toolName: LIST_MAP_TOOL,
    placement: 'afterProse',
    parse: (args) => {
      const parsed = ShowListMapSchema.safeParse(args)
      return parsed.success ? parsed.data : null
    },
    render: (list, { cardMode, onRefineArea }: ListWidgetContext) => (
      <ChatListMap {...list} onRefineArea={onRefineArea} mode={cardMode} />
    ),
  }),
  defineWidgetTool({
    toolName: LIST_PROPOSAL_TOOL,
    placement: 'afterProse',
    // The key is derived from the conversation and the tool call, so the card
    // asks after the same list on every reload without the model writing it.
    parse: (args, call) => {
      const parsed = ListProposalSchema.safeParse(args)
      if (!parsed.success || !call.toolCallId || !call.conversationId) {
        return null
      }
      return {
        ...parsed.data,
        proposalKey: mintProposalKey(call.conversationId, call.toolCallId),
      }
    },
    render: (
      proposal,
      { cardMode, onRefineArea, onListCreated }: ListWidgetContext,
    ) => (
      <ChatListProposal
        proposal={proposal}
        mode={cardMode}
        onRefineArea={onRefineArea}
        onCreated={(list) => onListCreated?.(list)}
      />
    ),
  }),
]
