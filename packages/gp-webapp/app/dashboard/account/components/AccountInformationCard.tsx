'use client'

import {
  Badge,
  Button,
  Card,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@styleguide'
import Image from 'next/image'
import Link from 'next/link'
import { MdOpenInNew } from 'react-icons/md'
import { PLAN_PRICING } from '@goodparty_org/contracts'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useOrganizationRole } from '@shared/organization-picker'
import { PaymentPortalButton } from '@shared/PaymentPortalButton'
import { SUPPORT_EMAIL } from '@shared/utils/supportContact'
import { proUpgradeHref } from 'app/dashboard/pro-upgrade/proUpgradeAttribution'
import { usePlan } from 'app/dashboard/shared/membership/deriveMembershipState'
import {
  buildPlanPitch,
  formatPlanCents,
} from 'app/dashboard/shared/plan/planPitch'
import { useWinPerCampaignPricingFlag } from '@shared/experiments/winPerCampaignPricingFlag'
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

const formatGoodThrough = (date: Date): string =>
  date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

const TEAM_UPGRADE_CTA = `Upgrade to Team for ${formatPlanCents(
  PLAN_PRICING.teamCents - PLAN_PRICING.proCents,
)}`

export const AccountInformationCard = ({
  user,
  isPro,
  isElectedOffice,
  subscriptionCancelAt,
  subscriptionId,
}: AccountInformationCardProps): React.JSX.Element => {
  const userType = isElectedOffice ? 'Elected official' : 'Candidate'
  const { enabled: planPricingEnabled } = useWinPerCampaignPricingFlag()
  const { plan, planEndsAt } = usePlan()
  const [campaign] = useCampaign()
  const role = useOrganizationRole()
  const paidPlan = buildPlanPitch(true, planPricingEnabled, plan === 'team')
  // Subscribers (planPricingModel subscription, or a legacy row with none)
  // keep the subscription label and Manage Subscription.
  const oneTimePlan =
    planPricingEnabled &&
    isPro &&
    !isElectedOffice &&
    campaign?.planPricingModel === 'one_time'
  const showPlansLink = planPricingEnabled && !isPro && !isElectedOffice
  const planLabel = oneTimePlan
    ? `GoodParty.org ${paidPlan.name} Plan`
    : isPro
      ? 'GoodParty.org Pro Plan - $10/month'
      : planPricingEnabled
        ? 'GoodParty.org Free Plan'
        : 'GoodParty.org Base Plan - Free'

  return (
    <Card className="w-full max-w-[640px] gap-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="m-0 text-xl font-semibold text-foreground">
          Account Information
        </h2>
        {oneTimePlan ? (
          <PaymentPortalButton variant="outline">
            Billing history
            <MdOpenInNew className="ml-2" />
          </PaymentPortalButton>
        ) : showPlansLink ? (
          <Button asChild>
            <Link href="/dashboard/plans">See plans</Link>
          </Button>
        ) : (
          <AccountSettingsButton
            isPro={isPro}
            isElectedOffice={isElectedOffice}
            subscriptionId={subscriptionId}
            customerId={user.metaData?.customerId}
          />
        )}
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

      {oneTimePlan && planEndsAt && (
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-muted-foreground">
            Good through
          </span>
          <p className="m-0 text-sm text-foreground">
            {formatGoodThrough(planEndsAt)}{' '}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="cursor-pointer border-0 bg-transparent p-0 text-sm text-muted-foreground underline"
                >
                  Why this date?
                </button>
              </PopoverTrigger>
              <PopoverContent className="text-sm">
                <p className="m-0">
                  Your plan runs {PLAN_PRICING.accessDaysAfterElection / 7}{' '}
                  weeks after election day, so this date moves if the election
                  moves. Headed to a runoff?{' '}
                  <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
                    Contact us
                  </a>
                  .
                </p>
              </PopoverContent>
            </Popover>
          </p>
        </div>
      )}

      {oneTimePlan && plan === 'pro' && role === 'owner' && (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-sm text-foreground">
            Working with a campaign manager or volunteers? Upgrade to Team to
            give them their own logins. You pay the{' '}
            {formatPlanCents(PLAN_PRICING.teamCents - PLAN_PRICING.proCents)}{' '}
            difference, and your outreach credit and dates stay the same.
          </p>
          <div>
            <Button asChild variant="outline">
              <Link
                href={`${proUpgradeHref({
                  source: 'navigation',
                  channel: 'generic',
                  cta: TEAM_UPGRADE_CTA,
                })}&plan=team`}
              >
                {TEAM_UPGRADE_CTA}
              </Link>
            </Button>
          </div>
        </div>
      )}

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
