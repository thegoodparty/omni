import { Badge } from '@styleguide'
import { PLANS_COPY } from './plansCopy'

interface PlanOfferProps {
  offer: string
}

export const PlanOffer = ({ offer }: PlanOfferProps): React.JSX.Element => (
  <span className="inline-flex flex-wrap items-center justify-center gap-2 font-semibold">
    <Badge variant="soft" shape="pill">
      {PLANS_COPY.bonus}
    </Badge>
    {offer}
  </span>
)
