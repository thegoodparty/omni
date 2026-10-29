import type { ReactNode } from 'react'
import {
  LEGACY_PRESENT_CARD_TOOLS,
  PRESENT_CARD_TOOL,
  PresentCardInputSchema,
  PresentCardSchema,
  mintProposalKey,
  type PresentCard,
  type PresentCardKind,
  type ShowListMap,
} from '@goodparty_org/contracts'
import ChatListMap from '../../../chief-of-staff/components/chat/ChatListMap'
import ChatListProposal from '../../../chief-of-staff/components/chat/ChatListProposal'
import CurrentLawSummaryWidget from '../../../ordinances/components/CurrentLawSummaryWidget'
import LegislativeHistoryWidget from '../../../ordinances/components/LegislativeHistoryWidget'
import {
  defineWidgetTool,
  type WidgetPlacement,
  type WidgetToolCall,
} from '../widgetRegistry'
import { cardDetailKey } from './cardWidgets'
import { ConstituentsCard } from './ConstituentsCard'
import { OutsideContactCard } from './OutsideContactCard'
import { PastOutreachCard } from './PastOutreachCard'
import type { CardMode } from './proposalPresentation'

export type PresentCardWidgetContext = {
  // Campaign Manager is Win: voters, and a Pro gate on saving a list.
  cardMode?: CardMode
  // Absent while the drawing surface is open for any list, so no other card
  // can remount it and discard the ring being drawn.
  onRefineArea?: (list: ShowListMap) => void
  onListCreated?: (list: ShowListMap) => void
}

type CardByKind = { [K in PresentCardKind]: Extract<PresentCard, { kind: K }> }

type CardView<K extends PresentCardKind> = {
  placement?: WidgetPlacement
  // A card that parses but has nothing to show drops like a parse failure.
  shows?: (card: CardByKind[K], call: WidgetToolCall) => boolean
  render: (
    card: CardByKind[K],
    ctx: PresentCardWidgetContext,
    call: WidgetToolCall,
  ) => ReactNode
}

// One view per kind in the contracts catalog. A kind added there without a
// view here fails the build.
const PRESENT_CARD_VIEWS: { [K in PresentCardKind]: CardView<K> } = {
  outside_contact: {
    render: (card, _ctx, call) => (
      <OutsideContactCard card={card} {...cardDetailKey(call)} />
    ),
  },
  past_outreach: {
    render: (card) => <PastOutreachCard card={card} />,
  },
  constituents: {
    render: (card, _ctx, call) => (
      <ConstituentsCard card={card} {...cardDetailKey(call)} />
    ),
  },
  // The list proposal and the map render after the turn's prose. The
  // proposal shares the map's place because once its list is created the
  // card becomes that map.
  list_proposal: {
    placement: 'afterProse',
    // The key is derived from the conversation and the tool call, so the card
    // asks after the same list on every reload without the model writing it.
    shows: (_card, call) =>
      call.toolCallId !== null && call.conversationId !== null,
    render: (card, { cardMode, onRefineArea, onListCreated }, call) => (
      <ChatListProposal
        proposal={{
          name: card.name,
          summary: card.summary,
          count: card.count,
          filters: card.filters,
          proposalKey: mintProposalKey(
            call.conversationId ?? '',
            call.toolCallId ?? '',
          ),
        }}
        mode={cardMode}
        onRefineArea={onRefineArea}
        onCreated={(list) => onListCreated?.(list)}
      />
    ),
  },
  list_map: {
    placement: 'afterProse',
    render: (card, { cardMode, onRefineArea }) => (
      <ChatListMap
        listId={card.listId}
        name={card.name}
        onRefineArea={onRefineArea}
        mode={cardMode}
      />
    ),
  },
  current_law_summary: {
    render: (card) => <CurrentLawSummaryWidget summary={card} />,
  },
  legislative_history: {
    // An empty timeline would occupy an assistant row and hold back the
    // working shimmer.
    shows: (card) => card.entries.length > 0,
    render: (card) => <LegislativeHistoryWidget history={card} />,
  },
}

const viewOf = <K extends PresentCardKind>(kind: K): CardView<K> =>
  PRESENT_CARD_VIEWS[kind]

const shownCard = <K extends PresentCardKind>(
  kind: K,
  card: CardByKind[K],
  call: WidgetToolCall,
): PresentCard | null => {
  const shows = viewOf(kind).shows
  return !shows || shows(card, call) ? card : null
}

const renderCard = <K extends PresentCardKind>(
  kind: K,
  card: CardByKind[K],
  ctx: PresentCardWidgetContext,
  call: WidgetToolCall,
): ReactNode => viewOf(kind).render(card, ctx, call)

const presentCardWidget = (
  toolName: string,
  toCard: (args: unknown) => PresentCard | null,
) =>
  defineWidgetTool({
    toolName,
    parse: (args, call) => {
      const card = toCard(args)
      return card ? shownCard(card.kind, card, call) : null
    },
    placement: (card) => viewOf(card.kind).placement ?? 'inline',
    slot: (card) => `${PRESENT_CARD_TOOL}:${card.kind}`,
    render: (card, ctx: PresentCardWidgetContext, call) =>
      renderCard(card.kind, card, ctx, call),
  })

// present_card, plus every tool a kind used to be: persisted segments carry
// the old names forever, with the card's fields as their args.
export const presentCardWidgetTools = [
  presentCardWidget(PRESENT_CARD_TOOL, (args) => {
    const parsed = PresentCardInputSchema.safeParse(args)
    return parsed.success ? parsed.data.card : null
  }),
  ...Object.entries(LEGACY_PRESENT_CARD_TOOLS).map(([toolName, kind]) =>
    presentCardWidget(toolName, (args) => {
      if (typeof args !== 'object' || args === null) return null
      const parsed = PresentCardSchema.safeParse({ ...args, kind })
      return parsed.success ? parsed.data : null
    }),
  ),
]
