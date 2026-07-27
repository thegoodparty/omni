'use client'

import { VoterContactsProvider } from '@shared/hooks/VoterContactsProvider'
import { CampaignUpdateHistoryProvider } from '@shared/hooks/CampaignUpdateHistoryProvider'
import CampaignManagerTasks from './CampaignManagerTasks'
import ProUpgradeBanner from '../components/campaignManager/ProUpgradeBanner'
import ProgressSection from '../components/campaignManager/ProgressSection'
import { useCampaignManagerChat } from './CampaignManagerChatProvider'

/**
 * The Campaign Manager dashboard home for the campaign-story cohort: the Pro
 * banner, the progress section, the first-run "meet your campaign manager"
 * card, and the top tracker tasks.
 *
 * The persistent footer chat bar and the chat surface are NOT rendered here —
 * they live in the always-present dock (CampaignManagerChatProvider, mounted in
 * DashboardLayout) so the manager is reachable from every page. This home reads
 * the dock's controls from context: the meet card opens the manager (dismissing
 * itself), and the personalize card launches the story-intake flow.
 */
export default function CampaignManagerHome(): React.JSX.Element {
  const chat = useCampaignManagerChat()

  return (
    <div className="flex min-h-screen flex-col bg-muted">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 pt-6">
        <ProUpgradeBanner />
        <VoterContactsProvider>
          <CampaignUpdateHistoryProvider>
            <ProgressSection />
          </CampaignUpdateHistoryProvider>
        </VoterContactsProvider>
      </div>
      {/* onMeetManager is a general open, so it dismisses the meet card.
          onPersonalize launches the story-intake chat flow without dismissing
          the meet card, same as the deep link the plan-tab gate links use. */}
      <CampaignManagerTasks
        showMeetCard={!chat?.meetDismissed}
        onMeetManager={() => chat?.openManager()}
        onSkipMeet={() => chat?.dismissMeetCard()}
        onPersonalize={() => chat?.startStory()}
      />
    </div>
  )
}
