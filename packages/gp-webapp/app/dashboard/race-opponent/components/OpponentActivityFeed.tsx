'use client'

import { Card, Skeleton } from '@styleguide'
import { ExternalLinkIcon } from '@styleguide/components/ui/icons'
import type { RaceOpponentActivityResponse } from 'gpApi/api-endpoints'

type Props = {
  activity: RaceOpponentActivityResponse
}

const Loading = (): React.JSX.Element => (
  <div className="flex flex-col gap-3">
    <Skeleton className="h-24 w-full rounded-lg" />
    <Skeleton className="h-24 w-full rounded-lg" />
  </div>
)

// Sourced-or-silent: even on the activity stream, a finding without a usable
// source link is dropped rather than surfaced unverifiable.
const hasSourceLink = (sourceUrl: string): boolean =>
  typeof sourceUrl === 'string' && sourceUrl.trim().length > 0

const ActivityItem = ({
  item,
}: {
  item: RaceOpponentActivityResponse['findings'][number]
}): React.JSX.Element => (
  <Card className="flex flex-col gap-2 p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {item.category}
        </span>
        <p className="text-sm font-medium text-foreground">{item.claim}</p>
      </div>
      {item.newSinceLastVisit && (
        <span className="shrink-0 rounded-full bg-info-dark px-2 py-0.5 text-xs font-semibold text-info-contrast">
          New
        </span>
      )}
    </div>
    <a
      href={item.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm font-semibold text-info hover:underline"
    >
      <span className="break-all">{item.sourceTitle ?? item.sourceUrl}</span>
      <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
    </a>
  </Card>
)

const OpponentActivityFeed = ({ activity }: Props): React.JSX.Element => {
  const findings = activity.findings.filter((f) => hasSourceLink(f.sourceUrl))

  if (findings.length === 0 && activity.refresh.status === 'running') {
    return <Loading />
  }

  if (findings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing new yet. As we monitor your opponent, new sourced findings will
        appear here.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {findings.map((item) => (
        <ActivityItem key={item.id} item={item} />
      ))}
    </div>
  )
}

export default OpponentActivityFeed
