'use client'

import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { VoterContactsProvider } from '@shared/hooks/VoterContactsProvider'
import { CampaignUpdateHistoryProvider } from '@shared/hooks/CampaignUpdateHistoryProvider'
import { reportErrorToSentry } from '@shared/sentry'
import CampaignManagerTasks from './CampaignManagerTasks'
import ProUpgradeBanner from '../components/campaignManager/ProUpgradeBanner'
import ProgressSection from '../components/campaignManager/ProgressSection'
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
 * The Campaign Manager dashboard home for the campaign-story cohort: the top
 * tracker tasks, a persistent chat bar, and a "meet your campaign manager"
 * entry that opens the shared chat surface bound to the campaign_assistant
 * scope. The shared surface/body/footer default to Chief of Staff; here they
 * are passed the Campaign Manager client, history key, and label.
 *
 * The manager runs as a single ongoing conversation: opening it resumes the
 * candidate's existing thread (or creates one on first open), so it always
 * continues where they left off. The server seeds the resume-aware greeting as
 * the conversation's first message; until the candidate replies, the chat body
 * types that seeded greeting in on open (no separate client opener).
 */
export default function CampaignManagerHome({
  firstName,
}: Props): React.JSX.Element {
  const queryClient = useQueryClient()
  const [chatOpen, setChatOpen] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)

  // Resume-or-create the ongoing manager conversation, then open it by id so
  // the surface loads its transcript (starting with the seeded greeting).
  // Resolve before opening so the drawer opens straight into the conversation
  // rather than flashing an empty state.
  const openManager = useCallback(async () => {
    try {
      const { conversationId: id } =
        await campaignManagerChatApi.createConversation()
      setConversationId(id)
      // A conversation now exists, so refresh history: the footer picker shows
      // it and the first-run "meet" card drops away.
      void queryClient.invalidateQueries({
        queryKey: CAMPAIGN_MANAGER_HISTORY_KEY,
      })
    } catch (err) {
      reportErrorToSentry(err, {
        surface: 'campaign-manager-chat',
        phase: 'init',
      })
      // Fall back to a fresh chat (deferred create on first send).
      setConversationId(null)
    }
    setChatOpen(true)
  }, [queryClient])

  const openConversation = useCallback((id: string) => {
    setConversationId(id)
    setChatOpen(true)
  }, [])

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
        <CampaignManagerTasks onMeetManager={() => void openManager()} />
      </div>
      <FooterChatBar
        firstName={firstName}
        onOpen={() => void openManager()}
        onOpenConversation={openConversation}
        chatApi={campaignManagerChatApi}
        historyKey={CAMPAIGN_MANAGER_HISTORY_KEY}
        openLabel="Open campaign manager chat"
      />
      <ChiefOfStaffChatSurface
        open={chatOpen}
        onOpenChange={setChatOpen}
        initialConversationId={conversationId}
        title="Campaign manager"
        subtitle="Always on, focused on your week"
        chatApi={campaignManagerChatApi}
        analyticsLabel="campaign-manager-chat"
        historyKey={CAMPAIGN_MANAGER_HISTORY_KEY}
        defaultIntro={CAMPAIGN_MANAGER_INTRO}
      />
    </div>
  )
}
