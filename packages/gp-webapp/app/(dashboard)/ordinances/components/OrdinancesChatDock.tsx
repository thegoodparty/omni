'use client'

import { useState } from 'react'
import { useUser } from '@shared/hooks/useUser'
import FooterChatBar from '../../chief-of-staff/components/chat/FooterChatBar'
import ChiefOfStaffChatSurface from '../../chief-of-staff/components/chat/ChiefOfStaffChatSurface'

// The Chief of Staff footer chat bar + surface for the Ordinances page. No
// anchored resource — a plain entry point into the general CoS chat, the same
// dock the Community Issues list pages use.
export default function OrdinancesChatDock(): React.JSX.Element {
  const [user] = useUser()
  const [chatOpen, setChatOpen] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [openerKey, setOpenerKey] = useState<string | null>(null)

  const openNewChat = (): void => {
    setConversationId(null)
    setOpenerKey(null)
    setChatOpen(true)
  }

  const openConversation = (id: string): void => {
    setConversationId(id)
    setOpenerKey(id)
    setChatOpen(true)
  }

  return (
    <>
      <FooterChatBar
        firstName={user?.firstName ?? undefined}
        onOpen={openNewChat}
        onOpenConversation={openConversation}
      />
      <ChiefOfStaffChatSurface
        open={chatOpen}
        onOpenChange={setChatOpen}
        initialConversationId={conversationId}
        openerKey={openerKey}
      />
    </>
  )
}
