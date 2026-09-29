import type { ChatCard } from '@goodparty_org/contracts'
import { OutreachProposalCard } from './OutreachProposalCard'
import { PastOutreachCard } from './PastOutreachCard'
import { ContactsCard } from './ContactsCard'

export type ChatCardRendererProps = {
  card: ChatCard
  priorityId: string
  conversationId: string
}

/**
 * An unrecognized `kind` renders nothing rather than throwing, so a thread
 * written by a newer build still opens on an older one.
 */
export const ChatCardRenderer = ({
  card,
  priorityId,
  conversationId,
}: ChatCardRendererProps) => {
  switch (card.kind) {
    case 'outreach_proposal':
      return (
        <OutreachProposalCard
          proposal={card}
          priorityId={priorityId}
          conversationId={conversationId}
        />
      )
    case 'past_outreach':
      return <PastOutreachCard card={card} />
    case 'contacts':
      return <ContactsCard card={card} />
    default:
      return null
  }
}
