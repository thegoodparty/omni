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
  const [pendingFile, setPendingFile] = useState<File | undefined>(undefined)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [openerKey, setOpenerKey] = useState<string | null>(null)

  const openNewChat = (): void => {
    setPendingFile(undefined)
    setConversationId(null)
    setOpenerKey(null)
    setChatOpen(true)
  }

  const openWithFile = (file: File): void => {
    openNewChat()
    setPendingFile(file)
  }

  const openConversation = (id: string): void => {
    setPendingFile(undefined)
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
        onAttachFile={openWithFile}
      />
      <ChiefOfStaffChatSurface
        open={chatOpen}
        onOpenChange={(next) => {
          setChatOpen(next)
          if (!next) setPendingFile(undefined)
        }}
        pendingFile={pendingFile}
        initialConversationId={conversationId}
        openerKey={openerKey}
        analyticsSurface="ordinances_dock"
      />
    </>
  )
}
