'use client'

import { useState } from 'react'
import { VoterContactsProvider } from '@shared/hooks/VoterContactsProvider'
import { CampaignUpdateHistoryProvider } from '@shared/hooks/CampaignUpdateHistoryProvider'
import CampaignManagerTasks from './CampaignManagerTasks'
import ProUpgradeBanner from '../components/campaignManager/ProUpgradeBanner'
import ProgressSection from '../components/campaignManager/ProgressSection'
import FooterChatBar from '../chief-of-staff/components/chat/FooterChatBar'
import ChiefOfStaffChatSurface from '../chief-of-staff/components/chat/ChiefOfStaffChatSurface'
import {
  buildStoryOpener,
  CAMPAIGN_MANAGER_HISTORY_KEY,
  CAMPAIGN_MANAGER_INTRO,
  campaignManagerChatApi,
} from './campaignManagerChat'
import { useCampaignStoryStatus } from './useCampaignStoryStatus'

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

  // While the Campaign Story is unfinished, open with a resume-aware story
  // opener that asks the first missing question instead of the generic intro,
  // so the manager fulfills the story through chat. Falls back to the intro
  // once complete (or while the status is still loading).
  const { ready, missing } = useCampaignStoryStatus()
  const storyOpener =
    ready && missing.length > 0 ? buildStoryOpener(missing) : undefined
  const intro = storyOpener ?? CAMPAIGN_MANAGER_INTRO

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
    <div className="flex min-h-screen flex-col bg-muted pb-20 lg:pb-12">
      <div className="pb-40">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 pt-6">
          <ProUpgradeBanner />
          <VoterContactsProvider>
            <CampaignUpdateHistoryProvider>
              <ProgressSection />
            </CampaignUpdateHistoryProvider>
          </VoterContactsProvider>
        </div>
        <CampaignManagerTasks onMeetManager={openMeet} />
      </div>
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
        opener={greet ? intro : undefined}
        openerKey={greet ? 'meet' : null}
        title="Campaign manager"
        subtitle="Always on, focused on your week"
        chatApi={campaignManagerChatApi}
        analyticsLabel="campaign-manager-chat"
        historyKey={CAMPAIGN_MANAGER_HISTORY_KEY}
        defaultIntro={intro}
      />
    </div>
  )
}
