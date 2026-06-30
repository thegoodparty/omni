'use client'

import { Badge, Card } from '@styleguide'
import Image from 'next/image'
import { AccountSettingsButton } from 'app/dashboard/profile/components/AccountSettingsButton'
import { SubscriptionPendingCancellationAlert } from 'app/dashboard/profile/components/SubscriptionPendingCancellationAlert'
import { User } from 'helpers/types'

interface AccountInformationCardProps {
  user: User
  isPro: boolean
  isElectedOffice: boolean
  subscriptionCancelAt?: number | null
  subscriptionId?: string | null
}

const formatJoined = (createdAt?: Date | string): string => {
  if (!createdAt) return '—'
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export const AccountInformationCard = ({
  user,
  isPro,
  isElectedOffice,
  subscriptionCancelAt,
  subscriptionId,
}: AccountInformationCardProps): React.JSX.Element => {
  const userType = isElectedOffice ? 'Elected official' : 'Candidate'
  const planLabel = isPro
    ? 'GoodParty.org Pro Plan - $10/month'
    : 'GoodParty.org Base Plan - Free'

  return (
    <Card className="w-full max-w-[640px] gap-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="m-0 text-xl font-semibold text-foreground">
          Account Information
        </h2>
        <AccountSettingsButton
          isPro={isPro}
          isElectedOffice={isElectedOffice}
          subscriptionId={subscriptionId}
        />
      </div>

      {isPro && !!subscriptionCancelAt && (
        <SubscriptionPendingCancellationAlert
          subscriptionCancelAt={subscriptionCancelAt}
        />
      )}

      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-muted-foreground">
          User type
        </span>
        <p className="m-0 text-sm text-foreground">{userType}</p>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          Account type
        </span>
        <Badge variant="soft" className="gap-2">
          <Image
            src="/images/logo/heart.svg"
            alt="GoodParty.org"
            width={18}
            height={14}
          />
          <span>{planLabel}</span>
        </Badge>
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-muted-foreground">
          Joined
        </span>
        <p className="m-0 text-sm text-foreground">
          {formatJoined(user.createdAt)}
        </p>
      </div>
    </Card>
  )
}
