import type { ListDetailReachability } from '../shared/contacts-types'
import {
  REACHABILITY_CHANNELS,
  SERVE_REACHABILITY_CHANNELS,
} from '../shared/reachabilityChannels'
import { SectionLabel, StatTile } from './ListDetailSection'

interface ReachabilityGridProps {
  reachability: ListDetailReachability | undefined
  isLoading: boolean
  isError: boolean
  // Win gets every channel, Serve drops the Win-only ones. Pass the
  // readiness-gated value: defaulting to the Serve set means a Serve user
  // never sees a robocall tile flash while the mode resolves, and a Win
  // user gains the extra tile a beat later instead of a Serve user being
  // told about a channel they cannot send.
  isWinContext: boolean
}

// Reachability tiles (Lovable-locked bordered icon tiles, ENG-10725;
// email/metaAds dropped in ENG-10783). Three states per tile
// (ENG-10806): still loading renders a neutral placeholder (never
// "Unavailable" — that read as an error during normal fetches); a resolved
// numeric value renders the count; a whole-route failure or a null channel
// (that one people-api aggregate call failed, ENG-10806) renders
// "Unavailable" for just that tile.
export default function ReachabilityGrid({
  reachability,
  isLoading,
  isError,
  isWinContext,
}: ReachabilityGridProps) {
  const channels = isWinContext
    ? REACHABILITY_CHANNELS
    : SERVE_REACHABILITY_CHANNELS
  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Reachable by channel</SectionLabel>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {channels.map(({ key, label, icon }) => {
          const value = reachability?.[key]
          const tileValue = isError
            ? 'Unavailable'
            : isLoading || reachability === undefined
              ? '—'
              : typeof value === 'number'
                ? value.toLocaleString()
                : 'Unavailable'
          return (
            <StatTile key={key} icon={icon} label={label} value={tileValue} />
          )
        })}
      </dl>
    </div>
  )
}
