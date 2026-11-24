import { ProBadge, TeamBadge } from '@styleguide'
import type { CampaignPlanName } from '@goodparty_org/contracts'

interface PlanBadgeProps {
  plan: CampaignPlanName
}

// Free has no badge. Pro and Team each have their own artwork.
export const PlanBadge = ({
  plan,
}: PlanBadgeProps): React.JSX.Element | null => {
  if (plan === 'pro') return <ProBadge size="small" />
  if (plan === 'team') return <TeamBadge size="small" />
  return null
}
