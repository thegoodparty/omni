import type { ListDetailReachability } from '../shared/contacts-types'
import { REACHABILITY_CHANNELS } from '../shared/reachabilityChannels'
import { SectionLabel, StatTile } from './ListDetailSection'

interface ReachabilityGridProps {
  reachability: ListDetailReachability | undefined
  isError: boolean
}

// Six-channel reachability tiles (Lovable-locked borderless dt/dd tiles,
// ENG-10725). `reachability` is undefined while loading and on a failed
// fetch — both render every tile as "Unavailable" rather than a misleading
// 0. A channel value of `null` (email and metaAds always, per the contract —
// no eligibility data source exists yet) renders the same "Unavailable"
// state, never 0.
export default function ReachabilityGrid({
  reachability,
  isError,
}: ReachabilityGridProps) {
  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Reachable by channel</SectionLabel>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3">
        {REACHABILITY_CHANNELS.map(({ key, label }) => {
          const value = isError ? undefined : reachability?.[key]
          return (
            <StatTile
              key={key}
              label={label}
              value={
                typeof value === 'number'
                  ? value.toLocaleString()
                  : 'Unavailable'
              }
            />
          )
        })}
      </dl>
    </div>
  )
}
