import type { ListDetailReachability } from '../shared/contacts-types'
import { formatFencedCount } from '../shared/formatFencedCount.util'
import { REACHABILITY_CHANNELS } from '../shared/reachabilityChannels'
import { SectionLabel, StatTile } from './ListDetailSection'

interface ReachabilityGridProps {
  reachability: ListDetailReachability | undefined
  isLoading: boolean
  isError: boolean
}

// Five-channel reachability tiles (Lovable-locked bordered icon tiles,
// ENG-10725; email/metaAds dropped in ENG-10783). Three states per tile
// (ENG-10806): still loading renders a neutral placeholder (never
// "Unavailable" — that read as an error during normal fetches); a resolved
// numeric value renders the (possibly fenced) count; a whole-route failure
// or a null channel (that one people-api aggregate call failed, ENG-10806)
// renders "Unavailable" for just that tile.
export default function ReachabilityGrid({
  reachability,
  isLoading,
  isError,
}: ReachabilityGridProps) {
  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Reachable by channel</SectionLabel>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {REACHABILITY_CHANNELS.map(({ key, label, icon }) => {
          const value = reachability?.[key]
          const tileValue = isError
            ? 'Unavailable'
            : isLoading || reachability === undefined
              ? '—'
              : typeof value === 'number'
                ? formatFencedCount(value, reachability?.fenced?.[key])
                : 'Unavailable'
          return (
            <StatTile key={key} icon={icon} label={label} value={tileValue} />
          )
        })}
      </dl>
    </div>
  )
}
