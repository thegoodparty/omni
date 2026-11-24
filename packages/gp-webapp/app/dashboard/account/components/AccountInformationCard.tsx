'use client'

import {
  Badge,
  Button,
  Card,
  ExternalLinkIcon,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  Separator,
} from '@styleguide'
import Image from 'next/image'
import Link from 'next/link'
import { PLAN_PRICING } from '@goodparty_org/contracts'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useOrganizationRole } from '@shared/organization-picker'
import { PaymentPortalButton } from '@shared/PaymentPortalButton'
import { SUPPORT_EMAIL } from '@shared/utils/supportContact'
import { planCheckoutHref } from 'app/dashboard/plans/planCheckoutHref'
import { usePlan } from 'app/dashboard/shared/membership/deriveMembershipState'
import { PlanBadge } from 'app/dashboard/shared/plan/PlanBadge'
import {
  buildPlanPitch,
  formatPlanCents,
} from 'app/dashboard/shared/plan/planPitch'
import { formatPlanEndDate } from 'app/dashboard/shared/plan/formatPlanEndDate'
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
  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

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
  const { plan, planEndsAt, creditCents } = usePlan()
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
  const freePlan = planPricingEnabled && !isPro && !isElectedOffice
  const creditTotalCents = Math.max(
    PLAN_PRICING.includedCreditCents,
    creditCents,
  )
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
            <ExternalLinkIcon className="ml-2 size-4" />
          </PaymentPortalButton>
        ) : freePlan ? null : (
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

      {oneTimePlan ? (
        <>
          <Separator />
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-4">
              <PlanBadge plan={plan} />
              <span className="text-sm font-semibold text-foreground">
                {paidPlan.price}
              </span>
            </div>
            <p className="m-0 text-sm text-muted-foreground">
              One payment.
              {planEndsAt
                ? ` Good through ${formatPlanEndDate(planEndsAt)}. `
                : ' '}
              {planEndsAt && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-sm text-muted-foreground"
                    >
                      Why this date?
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="text-sm">
                    <p className="m-0">
                      Your plan runs {PLAN_PRICING.accessDaysAfterElection / 7}{' '}
                      weeks after election day, so this date moves if the
                      election moves. Headed to a runoff?{' '}
                      <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
                        Contact us
                      </a>
                      .
                    </p>
                  </PopoverContent>
                </Popover>
              )}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
              <h3 className="m-0 text-sm font-semibold text-foreground">
                Outreach credit
              </h3>
              <span className="text-sm font-semibold text-foreground">
                {formatPlanCents(creditCents)} of{' '}
                {formatPlanCents(creditTotalCents)} left
              </span>
            </div>
            <Progress
              value={(creditCents / creditTotalCents) * 100}
              aria-label="Outreach credit left"
            />
            <p className="m-0 text-sm text-muted-foreground">
              {formatPlanCents(PLAN_PRICING.includedCreditCents)} came with{' '}
              {paidPlan.name}.
            </p>
          </div>
          <Separator />
        </>
      ) : freePlan ? (
        <>
          <Separator />
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-4">
              <Badge variant="soft">Free</Badge>
              <span className="text-sm font-semibold text-foreground">$0</span>
            </div>
            <p className="m-0 text-sm text-muted-foreground">
              Campaign plan, your campaign agent, your story and public profile.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <p className="m-0 text-sm text-foreground">
              Pro and Team add voter data, texts and robocalls, door knocking
              and phone banking. From {formatPlanCents(PLAN_PRICING.proCents)},
              one payment for your whole campaign.
            </p>
            <div>
              <Badge variant="soft">
                {formatPlanCents(PLAN_PRICING.includedCreditCents)} outreach
                credit
              </Badge>
            </div>
          </div>
          <div className="flex justify-end">
            <Button asChild>
              <Link href="/dashboard/plans">See plans</Link>
            </Button>
          </div>
          <Separator />
        </>
      ) : (
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
                href={planCheckoutHref(
                  'team',
                  'Join Team',
                  '/dashboard/account',
                )}
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
