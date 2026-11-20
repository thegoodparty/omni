import { Badge, ProBadge } from '@styleguide'
import type { PlanKey } from './plansCopy'

interface PlanNameProps {
  plan: PlanKey
  name: string
}

// The design shows Pro as the Pro badge; Free and Team have no artwork of
// their own, so they take a plain Badge.
export const PlanName = ({ plan, name }: PlanNameProps): React.JSX.Element =>
  plan === 'pro' ? (
    <ProBadge size="large" />
  ) : (
    <Badge variant={plan === 'free' ? 'soft' : 'default'}>{name}</Badge>
  )
