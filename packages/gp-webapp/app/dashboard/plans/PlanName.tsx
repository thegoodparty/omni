import { Badge, ProBadge, TeamBadge } from '@styleguide'
import type { PlanKey } from './plansCopy'

interface PlanNameProps {
  plan: PlanKey
  name: string
}

// Pro and Team are their badge artwork. Free has none, so it takes a Badge
// dressed to match.
export const PlanName = ({ plan, name }: PlanNameProps): React.JSX.Element => {
  if (plan === 'pro') return <ProBadge size="large" />
  if (plan === 'team') return <TeamBadge size="large" />
  return (
    <Badge variant="soft" shape="pill">
      {name.toUpperCase()}
    </Badge>
  )
}
