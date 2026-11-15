'use client'

import { VoterContactsProvider } from '@shared/hooks/VoterContactsProvider'
import { CampaignUpdateHistoryProvider } from '@shared/hooks/CampaignUpdateHistoryProvider'
import CampaignManagerTasks from '../CampaignManagerTasks'
import ProgressSection from '../../components/campaignManager/ProgressSection'
import { useCampaignManagerChat } from '../CampaignManagerChatProvider'
import RobocallFreeOfferCard from '../../shared/robocallFreeOffer/RobocallFreeOfferCard'
import { isFreeOfferTaskHref } from '../../shared/robocallFreeOffer/isFreeOfferTask'
import { useTrackerTasks } from '../../campaign-plan/components/campaignStrategy/useTrackerTasks'
import { selectTopDynamicTasks } from '../selectTopDynamicTasks'

/**
 * The Campaign Manager dashboard home for the campaign-story cohort: the
 * progress section, the first-run "meet your campaign manager" card, and the
 * top tracker tasks. Pro and texting status live in the sidebar's
 * MembershipBanner, not here.
 *
 * The persistent footer chat bar and the chat surface are NOT rendered here —
 * they live in the always-present dock (CampaignManagerChatProvider, mounted in
 * DashboardLayout) so the manager is reachable from every page. This home reads
 * the dock's controls from context: the meet card opens the manager (dismissing
 * itself), and the personalize card launches the story-intake flow.
 */
export default function CampaignManagerHome(): React.JSX.Element {
  const chat = useCampaignManagerChat()
  // The priorities below already list the offer's task, so its card would
  // show the offer twice.
  const { tasks } = useTrackerTasks()
  const offerTaskListed = selectTopDynamicTasks(tasks).some((task) =>
    isFreeOfferTaskHref(task.link),
  )

  return (
    <div className="flex min-h-screen flex-col bg-muted">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 pt-6">
        <VoterContactsProvider>
          <CampaignUpdateHistoryProvider>
            <ProgressSection />
          </CampaignUpdateHistoryProvider>
        </VoterContactsProvider>
        {!offerTaskListed && <RobocallFreeOfferCard />}
      </div>
      {/* onMeetManager is a general open, so it dismisses the meet card.
          onPersonalize launches the story-intake chat flow without dismissing
          the meet card, same as the deep link the plan-tab gate links use. */}
      <CampaignManagerTasks
        showMeetCard={!chat?.meetDismissed}
        onMeetManager={() => chat?.openManager()}
        onSkipMeet={() => chat?.dismissMeetCard()}
        onPersonalize={() => chat?.startStory()}
        onGetOnBallot={() => chat?.startBallotAccess()}
      />
    </div>
  )
}
