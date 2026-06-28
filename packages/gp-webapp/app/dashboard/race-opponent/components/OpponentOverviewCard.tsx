import { Avatar, AvatarFallback, Card } from '@styleguide'
import OpponentBadge, { type OpponentBadgeTone } from './OpponentBadge'

type Props = {
  name: string
  initials: string
  party?: string | null
  // true -> "Incumbent", false -> "Challenger", null/undefined -> no badge.
  isIncumbent?: boolean | null
  summary?: string | null
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
  summary,
  actions,
  children,
}: Props): React.JSX.Element => (
  <Card className="h-full gap-4 p-6">
    <div className="flex items-start gap-4">
      <Avatar size="large" className="shrink-0">
        <AvatarFallback className="bg-info-50 font-semibold text-info-600">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="text-lg font-semibold text-foreground">{name}</h3>
        <div className="flex flex-wrap items-center gap-2">
          {party && <OpponentBadge label={party} tone={partyTone(party)} />}
          {isIncumbent === true && <OpponentBadge label="Incumbent" />}
          {isIncumbent === false && <OpponentBadge label="Challenger" />}
        </div>
        {summary && (
          <p className="line-clamp-2 w-full min-w-0 break-words text-sm text-muted-foreground">
            {summary}
          </p>
        )}
        {children}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  </Card>
)

export default OpponentOverviewCard
