import { Badge, ProBadge } from '@styleguide'
import type { CampaignPlanName } from '@goodparty_org/contracts'

interface PlanBadgeProps {
  plan: CampaignPlanName
}

// Free has no badge. Team has no artwork of its own, so it takes a plain Badge.
export const PlanBadge = ({
  plan,
}: PlanBadgeProps): React.JSX.Element | null => {
  if (plan === 'pro') return <ProBadge size="small" />
  if (plan === 'team') {
    return (
      <Badge className="px-1.5 py-0.5 text-[10px] font-semibold tracking-wide">
        TEAM
      </Badge>
    )
  }
  return null
}
