import { Avatar, AvatarFallback, Card } from '@styleguide'
import OpponentBadge, { type OpponentBadgeTone } from './OpponentBadge'

type Props = {
  name: string
  initials: string
  party?: string
  isIncumbent?: boolean
  actions?: React.ReactNode
  children?: React.ReactNode
}

const partyTone = (party: string): OpponentBadgeTone => {
  const normalized = party.trim().toLowerCase()
  if (normalized === 'democrat' || normalized === 'democratic') {
    return 'democrat'
  }
  if (normalized === 'republican') {
    return 'republican'
  }
  return 'neutral'
}

const OpponentOverviewCard = ({
  name,
  initials,
  party,
  isIncumbent,
  actions,
  children,
}: Props): React.JSX.Element => (
  <Card className="gap-4 p-6">
    <div className="flex items-start gap-4">
      <Avatar size="large" className="shrink-0">
        <AvatarFallback className="bg-info-50 font-semibold text-info-600">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="text-lg font-semibold text-foreground">{name}</h3>
          <div className="flex flex-wrap items-center gap-2">
            {party && <OpponentBadge label={party} tone={partyTone(party)} />}
            {isIncumbent && <OpponentBadge label="Incumbent" />}
          </div>
        </div>
        {children}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  </Card>
)

export default OpponentOverviewCard
