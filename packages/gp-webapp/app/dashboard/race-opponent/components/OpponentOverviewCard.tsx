import { Avatar, AvatarFallback } from '@styleguide'
import type { RaceOpponentThreatTier } from '@goodparty_org/contracts'
import ThreatTierBadge from './ThreatTierBadge'

type Props = {
  name: string
  initials: string
  party?: string | null
  // true -> "Incumbent", false -> "Challenger", null/undefined -> omitted.
  isIncumbent?: boolean | null
  // Phase 3 threat tier; omitted -> no badge (no placeholder).
  threatTier?: RaceOpponentThreatTier
}

const descriptorFor = (
  party: string | null | undefined,
  isIncumbent: boolean | null | undefined,
): string | null => {
  const parts = [
    party || null,
    isIncumbent === true
      ? 'Incumbent'
      : isIncumbent === false
        ? 'Challenger'
        : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}

// The visual content of an opponent selector row. The expandable box (border,
// hover, open ring) is owned by the accordion item/trigger that wraps this in
// RaceOpponentList, so this only renders the avatar + name + party/role line.
const OpponentOverviewCard = ({
  name,
  initials,
  party,
  isIncumbent,
  threatTier,
}: Props): React.JSX.Element => {
  const descriptor = descriptorFor(party, isIncumbent)
  return (
    <div className="flex w-full min-w-0 items-center gap-3">
      <Avatar size="large" className="shrink-0">
        <AvatarFallback className="bg-info-50 font-semibold text-info-600">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-base font-semibold text-foreground">
          {name}
        </span>
        {descriptor && (
          <span className="truncate text-sm text-muted-foreground">
            {descriptor}
          </span>
        )}
        {threatTier && <ThreatTierBadge tier={threatTier} className="w-fit" />}
      </div>
    </div>
  )
}

export default OpponentOverviewCard
