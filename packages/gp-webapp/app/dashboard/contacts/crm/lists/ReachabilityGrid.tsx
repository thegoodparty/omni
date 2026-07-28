import type { ListDetailReachability } from '../shared/contacts-types'
import { formatFencedCount } from '../shared/formatFencedCount.util'
import { REACHABILITY_CHANNELS } from '../shared/reachabilityChannels'
import { SectionLabel, StatTile } from './ListDetailSection'

interface ReachabilityGridProps {
  reachability: ListDetailReachability | undefined
  isError: boolean
}

// Five-channel reachability tiles (Lovable-locked bordered icon tiles,
// ENG-10725; email/metaAds dropped in ENG-10783). `reachability` is
// undefined while loading and on a failed fetch — both render every tile
// as "Unavailable" rather than a misleading 0.
export default function ReachabilityGrid({
  reachability,
  isError,
}: ReachabilityGridProps) {
  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Reachable by channel</SectionLabel>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {REACHABILITY_CHANNELS.map(({ key, label, icon }) => {
          const value = isError ? undefined : reachability?.[key]
          return (
            <StatTile
              key={key}
              icon={icon}
              label={label}
              value={
                typeof value === 'number'
                  ? formatFencedCount(value, reachability?.fenced?.[key])
                  : 'Unavailable'
              }
            />
          )
        })}
      </dl>
    </div>
  )
}
