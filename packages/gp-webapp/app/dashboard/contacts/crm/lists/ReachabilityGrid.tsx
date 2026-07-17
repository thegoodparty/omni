import { Card, SendIcon } from '@styleguide'
import type { ListDetailReachability } from '../shared/contacts-types'
import { REACHABILITY_CHANNELS } from '../shared/reachabilityChannels'
import { InfoSection } from '../person/InfoSection'

interface ReachabilityGridProps {
  reachability: ListDetailReachability | undefined
  isError: boolean
}

// Six-channel reachability tiles (locked design). `reachability` is undefined
// while loading and on a failed fetch — both render every tile as
// "Unavailable" rather than a misleading 0. A channel value of `null` (email
// and metaAds always, per the contract — no eligibility data source exists
// yet) renders the same "Unavailable" state, never 0.
export default function ReachabilityGrid({
  reachability,
  isError,
}: ReachabilityGridProps) {
  return (
    <InfoSection title="Reachable by Channel" icon={<SendIcon size={20} />}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {REACHABILITY_CHANNELS.map(({ key, label, icon }) => {
          const value = isError ? undefined : reachability?.[key]
          return (
            <Card key={key} className="p-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {icon}
                {label}
              </div>
              <p className="mt-1 text-xl font-semibold">
                {typeof value === 'number'
                  ? value.toLocaleString()
                  : 'Unavailable'}
              </p>
            </Card>
          )
        })}
      </div>
    </InfoSection>
  )
}
