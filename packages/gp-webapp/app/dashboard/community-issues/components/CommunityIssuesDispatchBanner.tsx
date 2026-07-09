'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'

const POLL_INTERVAL_MS = 5000

type Props = {
  initiallyRunning: boolean
}

/**
 * Non-blocking landing catch-up: fires once after the page has already
 * rendered, asking gp-api to dispatch a fresh run if the user landed back in
 * the product after being skipped for inactivity (or if a run is already
 * generating from an earlier landing, reflected in the server-fetched
 * `refresh.status`). Polls both lists until neither is `running`, then
 * clears itself.
 */
export default function CommunityIssuesDispatchBanner({
  initiallyRunning,
}: Props): React.JSX.Element | null {
  const [polling, setPolling] = useState(initiallyRunning)

  useEffect(() => {
    let cancelled = false
    void clientRequest('POST /v1/community-issues/dispatch-if-needed', {})
      .then(({ data }) => {
        if (!cancelled && data.dispatched > 0) {
          setPolling(true)
        }
      })
      .catch(() => {
        // Best-effort, non-blocking check — a failure here should not
        // surface to the user or affect the page render.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const { data: statuses } = useQuery({
    queryKey: ['community-issues', 'dispatch-poll'],
    queryFn: async () => {
      const [top, trending] = await Promise.all([
        clientRequest('GET /v1/community-issues', { list: 'top_community' }),
        clientRequest('GET /v1/community-issues', { list: 'trending' }),
      ])
      return {
        top: top.data.refresh.status,
        trending: trending.data.refresh.status,
      }
    },
    enabled: polling,
    refetchInterval: POLL_INTERVAL_MS,
  })

  useEffect(() => {
    if (!statuses) return
    if (statuses.top !== 'running' && statuses.trending !== 'running') {
      setPolling(false)
    }
  }, [statuses])

  if (!polling) return null

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-info-600 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-info-600" />
      </span>
      Refreshing your community issues...
    </div>
  )
}
