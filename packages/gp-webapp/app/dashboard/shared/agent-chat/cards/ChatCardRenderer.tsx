import type { ChatCard } from '@goodparty_org/contracts'
import { OutreachProposalCard } from './OutreachProposalCard'
import { PastOutreachCard } from './PastOutreachCard'
import { ConstituentsCard } from './ConstituentsCard'
import { OutsideContactCard } from './OutsideContactCard'

export type ChatCardRendererProps = {
  card: ChatCard
  priorityId?: string
  // Which detail this card opens. The live and the persisted copy of one tool
  // call share it, so a panel opened mid-turn stays open across the swap.
  detailKey?: string
}

/**
 * An unrecognized `kind` renders nothing rather than throwing, so a thread
 * written by a newer build still opens on an older one.
 */
export const ChatCardRenderer = ({
  card,
  priorityId,
  detailKey,
}: ChatCardRendererProps) => {
  const keyProp = detailKey !== undefined ? { detailKey } : {}
  switch (card.kind) {
    case 'outreach_proposal':
      return (
        <OutreachProposalCard
          proposal={card}
          {...(priorityId !== undefined && { priorityId })}
        />
      )
    case 'past_outreach':
      return <PastOutreachCard card={card} />
    case 'constituents':
      return <ConstituentsCard card={card} {...keyProp} />
    case 'outside_contact':
      return <OutsideContactCard card={card} {...keyProp} />
    default:
      return null
  }
}
