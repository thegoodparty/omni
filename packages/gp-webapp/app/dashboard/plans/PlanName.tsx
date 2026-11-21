import { Badge, ProBadge } from '@styleguide'
import type { PlanKey } from './plansCopy'

interface PlanNameProps {
  plan: PlanKey
  name: string
}

// Pro is the Pro badge artwork. Free and Team have no artwork of their own,
// so they take a Badge dressed to match it.
export const PlanName = ({ plan, name }: PlanNameProps): React.JSX.Element =>
  plan === 'pro' ? (
    <ProBadge size="large" />
  ) : (
    <Badge variant={plan === 'free' ? 'soft' : 'default'} shape="pill">
      {name.toUpperCase()}
    </Badge>
  )
