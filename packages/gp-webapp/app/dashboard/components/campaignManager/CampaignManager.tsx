'use client'

import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import HeaderSection from './HeaderSection'
import { useCampaign } from '@shared/hooks/useCampaign'
import ProgressSection from './ProgressSection'
import ProUpgradeBanner from './ProUpgradeBanner'
import TextingSetupBanner from './TextingSetupBanner'
import ProUpgrade3ComplianceCard from './ProUpgrade3ComplianceCard'
import { VoterContactsProvider } from '@shared/hooks/VoterContactsProvider'
import { CampaignUpdateHistoryProvider } from '@shared/hooks/CampaignUpdateHistoryProvider'
import { useCampaignStoryFlag } from '@shared/experiments/campaignStoryFlag'
import { TcrCompliance } from 'helpers/types'
import ElectionOver from '../ElectionOver'
import PrimaryResultModal from '../PrimaryResultModal'
import { usePostElectionState } from '../usePostElectionState'
import { usePositionName } from '@shared/hooks/usePositionName'
import Link from 'next/link'
import { Button, Card } from '@styleguide'
import LegacyDashboardTasks from './LegacyDashboardTasks'

// The dashboard home keeps its header / progress chrome and, in the task slot,
// branches on the campaign-story flag. Story cohort: tasks live in the campaign
// tracker on the Campaign Plan page, so point there. Story-off (legacy)
// cohort: the old campaign_task generator + checklist (LegacyDashboardTasks).
export default function CampaignManager({
  pathname,
  tcrCompliance,
}: {
  pathname: string
  tcrCompliance: TcrCompliance | null
}) {
  const [campaign] = useCampaign()
  const positionName = usePositionName()
  // trackExposure=false: this isn't the experiment's treatment surface (the
  // campaign-story page is), so reading the flag here must not fire exposure.
  const { ready: storyReady, enabled: storyEnabled } =
    useCampaignStoryFlag(false)
  const {
    electionInPast,
    primaryLost,
    primaryResultModalOpen,
    primaryElectionDate,
    electionDate,
    closePrimaryResultModal,
  } = usePostElectionState()
  const electionOver = electionInPast || primaryLost

  if (!campaign) {
    return null
  }

  return (
    <DashboardLayout
      pathname={pathname}
      campaign={campaign}
      wrapperClassName="!p-0"
    >
      <VoterContactsProvider>
        <CampaignUpdateHistoryProvider>
          <div className="mx-auto w-full max-w-160 flex flex-col gap-6 px-4 py-8 md:px-0">
            {electionOver ? (
              <ElectionOver />
            ) : (
              <>
                <HeaderSection />
                <ProUpgradeBanner />
                <TextingSetupBanner tcrCompliance={tcrCompliance} />
                <ProUpgrade3ComplianceCard />
                <ProgressSection />
                {!storyReady ? null : storyEnabled ? (
                  <Card className="mt-4 flex flex-col items-start gap-3 p-6">
                    <p className="text-muted-foreground">
                      Your weekly tasks live in your Campaign Plan, tailored to
                      your story and plan.
                    </p>
                    <Button asChild>
                      <Link href="/dashboard/campaign-plan">
                        Go to Campaign Plan
                      </Link>
                    </Button>
                  </Card>
                ) : (
                  <LegacyDashboardTasks
                    campaign={campaign}
                    tcrCompliance={tcrCompliance}
                  />
                )}
              </>
            )}
          </div>
          {primaryElectionDate && electionDate && (
            <PrimaryResultModal
              open={primaryResultModalOpen}
              onClose={closePrimaryResultModal}
              electionDate={electionDate}
              officeName={positionName}
            />
          )}
        </CampaignUpdateHistoryProvider>
      </VoterContactsProvider>
    </DashboardLayout>
  )
}
