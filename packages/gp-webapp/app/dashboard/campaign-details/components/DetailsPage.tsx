'use client'

import DashboardLayout from '../../shared/DashboardLayout'
import CampaignSection from './CampaignSection'
import OfficeSection from './OfficeSection'
import WhyRunningSection from './WhyRunningSection'
import PolicyPrioritiesSection from './PolicyPrioritiesSection'
import { CandidatePositionsProvider } from 'app/dashboard/campaign-details/components/issues/CandidatePositionsProvider'
import { useCampaign } from '@shared/hooks/useCampaign'
import { Campaign, User, CandidatePosition } from 'helpers/types'
import { Card } from '@styleguide'

interface TopIssue {
  id: number
  name: string
  positions?: { id: number; name: string }[]
}

interface DetailsPageProps {
  pathname: string
  campaign: Campaign | undefined
  candidatePositions: CandidatePosition[]
  topIssues: TopIssue[]
  user?: User | null
}

export default function DetailsPage(
  props: DetailsPageProps,
): React.JSX.Element {
  const [campaign] = useCampaign()
  const campaignProps = { ...props, campaign: campaign ?? undefined }

  return (
    <DashboardLayout {...props}>
      <CandidatePositionsProvider candidatePositions={props.candidatePositions}>
        <div className="max-w-[940px] mx-auto flex flex-col gap-4 py-5">
          {campaign && (
            <Card className="p-6">
              <CampaignSection {...campaignProps} carded />
            </Card>
          )}
          <Card className="p-6">
            <OfficeSection campaign={campaign ?? undefined} carded />
          </Card>
          <Card className="p-6">
            <WhyRunningSection />
          </Card>
          <Card className="p-6">
            <PolicyPrioritiesSection />
          </Card>
        </div>
      </CandidatePositionsProvider>
    </DashboardLayout>
  )
}
