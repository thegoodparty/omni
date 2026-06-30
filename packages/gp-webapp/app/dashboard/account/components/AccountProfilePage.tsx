'use client'

import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import DashboardPageHeader from 'app/dashboard/shared/DashboardPageHeader'
import { useOrganization } from '@shared/organization-picker'
import NotificationSection from 'app/dashboard/profile/components/NotificationSection'
import ProUpgrade3Compliance from 'app/dashboard/profile/texting-compliance-agentic/components/ProUpgrade3Compliance'
import { Campaign, User } from 'helpers/types'
import { PersonalInformationCard } from './PersonalInformationCard'
import { AccountInformationCard } from './AccountInformationCard'
import DeleteAccountPage from './DeleteAccountPage'

interface AccountProfilePageProps {
  user: User
  campaign: Campaign | null
  isPro?: boolean
  subscriptionCancelAt?: number | null
  subscriptionId?: string | null
}

const AccountProfilePage = ({
  user,
  campaign,
  isPro = false,
  subscriptionCancelAt,
  subscriptionId,
}: AccountProfilePageProps): React.JSX.Element => {
  const organization = useOrganization()
  const isElectedOffice = !!organization?.electedOfficeId

  return (
    <DashboardLayout pathname="/dashboard/account" wrapperClassName="!p-0">
      <DashboardPageHeader
        title="Account Settings"
        description="Manage your account settings and configuration."
      />

      <div className="w-full bg-muted px-4 py-6 pb-20 sm:px-8 md:px-16">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
          <PersonalInformationCard user={user} />

          {(!!campaign || isElectedOffice) && (
            <AccountInformationCard
              user={user}
              isPro={isPro}
              isElectedOffice={isElectedOffice}
              subscriptionCancelAt={subscriptionCancelAt}
              subscriptionId={subscriptionId}
            />
          )}

          {(!!campaign || isElectedOffice) && (
            <NotificationSection showCampaignChannels={!isElectedOffice} />
          )}

          {!!campaign && isPro && <ProUpgrade3Compliance />}

          <DeleteAccountPage />
        </div>
      </div>
    </DashboardLayout>
  )
}

export default AccountProfilePage
