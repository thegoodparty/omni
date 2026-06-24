'use client'

import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import HeaderSection from './HeaderSection'
import { useCampaign } from '@shared/hooks/useCampaign'
import ProgressSection from './ProgressSection'
import ProUpgradeBanner from './ProUpgradeBanner'
import ProUpgrade3ComplianceCard from './ProUpgrade3ComplianceCard'
import { VoterContactsProvider } from '@shared/hooks/VoterContactsProvider'
import { CampaignUpdateHistoryProvider } from '@shared/hooks/CampaignUpdateHistoryProvider'
import { TcrCompliance } from 'helpers/types'
import ElectionOver from '../ElectionOver'
import PrimaryResultModal from '../PrimaryResultModal'
import { usePostElectionState } from '../usePostElectionState'
import { usePositionName } from '@shared/hooks/usePositionName'
import Link from 'next/link'
import { Button, Card } from '@styleguide'

// The legacy campaign_task generator + task list has been retired: every
// candidate now goes through Campaign Story → Campaign Plan, where the campaign
// tracker owns the weekly task list. The dashboard home keeps its header /
// progress chrome and points at the Campaign Plan.
export default function CampaignManager({
  pathname,
}: {
  pathname: string
  tcrCompliance: TcrCompliance | null
}) {
  const [campaign] = useCampaign()
  const positionName = usePositionName()
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
                <ProUpgrade3ComplianceCard />
                <ProgressSection />
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
