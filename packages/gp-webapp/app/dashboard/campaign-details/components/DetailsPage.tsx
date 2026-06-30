'use client'

import DashboardLayout from '../../shared/DashboardLayout'
import DashboardPageHeader from 'app/dashboard/shared/DashboardPageHeader'
import ProfileHeroCard from './cards/ProfileHeroCard'
import OfficeDetailsCard from './cards/OfficeDetailsCard'
import YourDetailsCard from './cards/YourDetailsCard'
import MotivationCard from './cards/MotivationCard'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useUser } from '@shared/hooks/useUser'
import { useOrganization } from '@shared/organization-picker'
import { useQuery } from '@tanstack/react-query'
import {
  getUserWebsite,
  getWebsiteUrl,
  USER_WEBSITE_QUERY_KEY,
} from 'app/dashboard/website/util/website.util'
import { Campaign, User, Website } from 'helpers/types'
import { ExternalLink } from 'lucide-react'

interface DetailsPageProps {
  pathname: string
  campaign: Campaign | undefined
  user?: User | null
}

export default function DetailsPage(
  props: DetailsPageProps,
): React.JSX.Element {
  const [campaign] = useCampaign()
  const [user] = useUser()
  const organization = useOrganization()
  const isElectedOffice = !!organization?.electedOfficeId

  const { data: website } = useQuery<Website | null>({
    queryKey: USER_WEBSITE_QUERY_KEY,
    queryFn: getUserWebsite,
  })

  const activeCampaign = campaign ?? props.campaign
  const activeUser = user ?? props.user ?? null

  // Only surface "View public profile" once the candidate has a published
  // site to point at.
  const publicUrl =
    website?.vanityPath && website.status === 'published'
      ? getWebsiteUrl(website.vanityPath, false, website.domain)
      : undefined

  return (
    <DashboardLayout pathname={props.pathname} wrapperClassName="!p-0">
      <DashboardPageHeader
        title="Profile"
        description="Manage your public profile information"
        primaryAction={
          publicUrl
            ? {
                label: 'View public profile',
                icon: <ExternalLink size={16} />,
                onClick: () =>
                  window.open(publicUrl, '_blank', 'noopener,noreferrer'),
              }
            : undefined
        }
      />

      <div className="w-full bg-muted px-4 py-6 pb-20 sm:px-8 md:px-16">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
          <ProfileHeroCard user={activeUser} />

          <OfficeDetailsCard campaign={activeCampaign} />

          <YourDetailsCard campaign={activeCampaign} />

          {/* Motivation for running is candidate-only. */}
          {!isElectedOffice && <MotivationCard />}
        </div>
      </div>
    </DashboardLayout>
  )
}
