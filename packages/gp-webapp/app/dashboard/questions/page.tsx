import { fetchUserCampaign } from 'app/onboarding/shared/getCampaign'
import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from '../shared/candidateAccess'
import QuestionsPage from './components/QuestionsPage'
import {
  serverFetchIssues,
  serverLoadCandidatePosition,
} from 'app/dashboard/campaign-details/components/issues/serverIssuesUtils'

const meta = pageMetaData({
  title: 'Additional Questions | GoodParty.org',
  description: 'Additional Questions',
  slug: '/dashboard/questions',
})
export const metadata = meta

export const dynamic = 'force-dynamic'

interface PageParams {
  searchParams: Promise<{ generate?: string }>
}

export default async function Page({
  searchParams,
}: PageParams): Promise<React.JSX.Element> {
  await candidateAccess()
  const { generate } = await searchParams

  // fetchUserCampaign and serverFetchIssues are independent, so run them
  // concurrently; the campaign-dependent position load runs afterwards.
  const [campaign, topIssues] = await Promise.all([
    fetchUserCampaign(),
    serverFetchIssues(),
  ])
  const candidatePositions = campaign
    ? await serverLoadCandidatePosition(campaign.id)
    : []

  const childProps = {
    campaign,
    generate,
    candidatePositions,
    topIssues,
  }

  return <QuestionsPage {...childProps} />
}
