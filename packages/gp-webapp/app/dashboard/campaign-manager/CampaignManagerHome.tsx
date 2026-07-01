'use client'

import { useState } from 'react'
import CampaignManagerTasks from './CampaignManagerTasks'
import FooterChatBar from '../chief-of-staff/components/chat/FooterChatBar'
import ChiefOfStaffChatSurface from '../chief-of-staff/components/chat/ChiefOfStaffChatSurface'
import {
  CAMPAIGN_MANAGER_HISTORY_KEY,
  CAMPAIGN_MANAGER_INTRO,
  campaignManagerChatApi,
} from './campaignManagerChat'

interface Props {
  firstName?: string
}

/**
 * The Campaign Manager dashboard home for the campaign-story cohort: the top-3
 * tracker tasks, a persistent chat bar, and a "meet your campaign manager"
 * entry that opens the shared chat surface bound to the campaign_assistant
 * scope. The shared surface/body/footer default to Chief of Staff; here they
 * are passed the Campaign Manager client, history key, label, and greeting.
 */
export default function CampaignManagerHome({
  firstName,
}: Props): React.JSX.Element {
  const [chatOpen, setChatOpen] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  // Play the greeting only when opened via "meet" / a fresh chat, not when
  // reopening a past conversation.
  const [greet, setGreet] = useState(false)

  const openMeet = () => {
    setConversationId(null)
    setGreet(true)
    setChatOpen(true)
  }
  const openNew = () => {
    setConversationId(null)
    setGreet(false)
    setChatOpen(true)
  }
  const openConversation = (id: string) => {
    setConversationId(id)
    setGreet(false)
    setChatOpen(true)
  }

  return (
    <>
      <CampaignManagerTasks onMeetManager={openMeet} />
      <FooterChatBar
        firstName={firstName}
        onOpen={openNew}
        onOpenConversation={openConversation}
        chatApi={campaignManagerChatApi}
        historyKey={CAMPAIGN_MANAGER_HISTORY_KEY}
        openLabel="Open campaign manager chat"
      />
      <ChiefOfStaffChatSurface
        open={chatOpen}
        onOpenChange={setChatOpen}
        initialConversationId={conversationId}
        opener={greet ? CAMPAIGN_MANAGER_INTRO : undefined}
        openerKey={greet ? 'meet' : null}
        title="Campaign manager"
        subtitle="Always on, focused on your week"
        chatApi={campaignManagerChatApi}
        analyticsLabel="campaign-manager-chat"
        historyKey={CAMPAIGN_MANAGER_HISTORY_KEY}
        defaultIntro={CAMPAIGN_MANAGER_INTRO}
      />
    </>
  )
}
