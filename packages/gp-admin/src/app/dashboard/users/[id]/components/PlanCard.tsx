'use client'

import { Badge, Flex } from '@radix-ui/themes'
import type { EnrichedCampaign } from '@/app/dashboard/campaigns/actions'
import { formatDate } from '@/lib/utils/date'
import { InfoCard } from './InfoCard'
import { DataRow } from './DataRow'
import {
  ExtendPlanDialog,
  PLAN_LABELS,
  RefundPlanDialog,
  SetPlanDialog,
} from './PlanDialogs'

const PRICING_MODEL_LABELS = {
  subscription: 'Subscription',
  one_time: 'One time',
} as const

export function PlanCard({ campaign }: { campaign: EnrichedCampaign }) {
  const plan = campaign.plan ?? 'free'
  // gp-api computes this with planEndsAt(): the staff override, else the
  // election date plus the access window.
  const goodThrough = plan === 'free' ? null : campaign.planEndsAt
  const dialogProps = { campaignId: campaign.id, userId: campaign.userId }

  return (
    <InfoCard title="Plan">
      <DataRow label="Plan">
        <Badge color={plan === 'free' ? 'gray' : 'violet'}>
          {PLAN_LABELS[plan]}
        </Badge>
      </DataRow>
      <DataRow label="Pricing model">
        {campaign.planPricingModel
          ? PRICING_MODEL_LABELS[campaign.planPricingModel]
          : '—'}
      </DataRow>
      <DataRow label="Paid at">{formatDate(campaign.planPaidAt)}</DataRow>
      <DataRow label="Good through">{formatDate(goodThrough)}</DataRow>
      <DataRow label="Ended at">{formatDate(campaign.planEndedAt)}</DataRow>
      <DataRow label="Outreach credit">
        {`$${((campaign.outreachCreditCents ?? 0) / 100).toFixed(2)}`}
      </DataRow>
      <Flex gap="2" mt="3" wrap="wrap">
        <SetPlanDialog {...dialogProps} currentPlan={plan} />
        <ExtendPlanDialog {...dialogProps} />
        <RefundPlanDialog {...dialogProps} />
      </Flex>
    </InfoCard>
  )
}
