'use client'

import { useState } from 'react'
import { Button } from '@styleguide'
import { ExternalLinkIcon, RefreshIcon } from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import type {
  RaceOpponentItem,
  RaceOpponentResponse,
} from 'gpApi/api-endpoints'
import type { RaceOpponentSourceType } from '@goodparty_org/contracts'

const SOURCE_TYPE_LABELS: Record<RaceOpponentSourceType, string> = {
  ballotpedia: 'Ballotpedia',
  opponent_website: 'Opponent website',
  campaign_plan_db: 'Campaign plan',
}

const STATUS_LABELS: Record<RaceOpponentResponse['collectionStatus'], string> =
  {
    idle: 'Idle',
    discovering: 'Discovering opponents',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
  }

const formatTimestamp = (iso: string | null): string => {
  if (!iso) {
    return 'never'
  }
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'never' : date.toLocaleString()
}

const ContentBlock = ({ content }: { content: unknown }): React.JSX.Element => (
  <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs text-foreground">
    {typeof content === 'string' ? content : JSON.stringify(content, null, 2)}
  </pre>
)

const SourceGroup = ({
  sourceType,
  items,
}: {
  sourceType: RaceOpponentSourceType
  items: RaceOpponentItem[]
}): React.JSX.Element => (
  <section className="flex flex-col gap-2">
    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {SOURCE_TYPE_LABELS[sourceType]}
    </h4>
    {items.map((item) => (
      <div
        key={item.id}
        className="flex flex-col gap-2 rounded-md border border-border bg-card p-3"
      >
        {item.sourceUrl ? (
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-semibold text-info-600 hover:underline"
          >
            <span className="break-all">{item.sourceUrl}</span>
            <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
          </a>
        ) : (
          <span className="text-sm text-muted-foreground">No source URL</span>
        )}
        <ContentBlock content={item.content} />
      </div>
    ))}
  </section>
)

const groupBySourceType = (
  items: RaceOpponentItem[],
): Array<{ sourceType: RaceOpponentSourceType; items: RaceOpponentItem[] }> => {
  const order: RaceOpponentSourceType[] = [
    'ballotpedia',
    'opponent_website',
    'campaign_plan_db',
  ]
  return order
    .map((sourceType) => ({
      sourceType,
      items: items.filter((item) => item.sourceType === sourceType),
    }))
    .filter((group) => group.items.length > 0)
}

type Props = {
  initialData: RaceOpponentResponse
}

const RaceOpponentList = ({ initialData }: Props): React.JSX.Element => {
  const { errorSnackbar } = useSnackbar()
  const [data, setData] = useState<RaceOpponentResponse>(initialData)
  const [refreshing, setRefreshing] = useState(false)
  const [collecting, setCollecting] = useState(false)

  const refresh = async () => {
    setRefreshing(true)
    try {
      const { data: latest } = await clientRequest(
        'GET /v1/campaigns/mine/race-opponent',
        {},
      )
      setData(latest)
    } catch {
      errorSnackbar('Failed to refresh opponent data. Please try again.')
    } finally {
      setRefreshing(false)
    }
  }

  const collect = async () => {
    setCollecting(true)
    try {
      const { data: result } = await clientRequest(
        'POST /v1/campaigns/mine/race-opponent/collect',
        {},
      )
      setData((prev) => ({
        ...prev,
        collectionStatus: result.status,
      }))
    } catch {
      errorSnackbar('Failed to start collection. Please try again.')
    } finally {
      setCollecting(false)
    }
  }

  // Discovery (opposition_research) and collection both keep the run busy, so
  // both disable a fresh Collect to avoid stacking paid runs.
  const isBusy =
    data.collectionStatus === 'running' ||
    data.collectionStatus === 'discovering'

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 pb-28 pt-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-xl font-semibold text-foreground">
            Know your opponent
          </h1>
          <p className="text-sm text-muted-foreground">
            Raw collected research on your opponents, grouped by source.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            Status:{' '}
            <span className="font-semibold text-foreground">
              {STATUS_LABELS[data.collectionStatus]}
            </span>
          </span>
          <span>Last collected: {formatTimestamp(data.lastCollectedAt)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={collect}
            disabled={collecting || isBusy}
            className="flex items-center gap-1.5"
          >
            <RefreshIcon className="size-4" aria-hidden />
            Collect now
          </Button>
          <Button
            variant="outline"
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-1.5"
          >
            <RefreshIcon className="size-4" aria-hidden />
            Refresh
          </Button>
        </div>
      </header>

      {data.opponents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No opponent data collected yet. Click &quot;Collect now&quot; to
          start.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {data.opponents.map((opponent) => (
            <section
              key={opponent.opponentName}
              className="flex flex-col gap-3"
            >
              <h2 className="text-base font-semibold text-foreground">
                {opponent.opponentName}
              </h2>
              <div className="flex flex-col gap-4">
                {groupBySourceType(opponent.items).map((group) => (
                  <SourceGroup
                    key={group.sourceType}
                    sourceType={group.sourceType}
                    items={group.items}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

export default RaceOpponentList
