'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'

const POLL_INTERVAL_MS = 30000
const MAX_POLL_ATTEMPTS = 40 // 30s x 40 = 20 min ceiling

/**
 * Non-blocking landing catch-up: fires once after the dashboard has already
 * rendered, asking gp-api to dispatch a briefing if the user landed back in
 * the product after being skipped for inactivity (or if a briefing is
 * already generating from an earlier landing). Polls the meetings list
 * until that meeting's briefing is ready, then clears itself.
 */
export default function BriefingDispatchBanner(): React.JSX.Element | null {
  const [pendingMeetingDate, setPendingMeetingDate] = useState<string | null>(
    null,
  )
  const pollAttempts = useRef(0)
  const queryClient = useQueryClient()

  useEffect(() => {
    let cancelled = false
    void clientRequest('POST /v1/meetings/dispatch-if-needed', {})
      .then(({ data }) => {
        if (!cancelled && data.inFlight && data.meetingDate) {
          setPendingMeetingDate(data.meetingDate)
        }
      })
      .catch(() => {
        // Best-effort, non-blocking check — a failure here should not
        // surface to the user or affect the dashboard render.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const { data: meetings } = useQuery({
    queryKey: ['chief-of-staff', 'briefing-dispatch-poll'],
    queryFn: () =>
      clientRequest('GET /v1/meetings', {}).then((res) => res.data),
    enabled: pendingMeetingDate !== null,
    refetchInterval: POLL_INTERVAL_MS,
  })

  useEffect(() => {
    if (!pendingMeetingDate || !meetings) return
    const meeting = meetings.meetings.find(
      (m) => m.meetingDate === pendingMeetingDate,
    )
    pollAttempts.current += 1
    if (meeting?.hasBriefing || pollAttempts.current >= MAX_POLL_ATTEMPTS) {
      // Invalidate on both paths (ready and timeout): a briefing that lands
      // near the ceiling still generated cards, and useDashboardCards has no
      // refetchInterval, so without this they stay hidden until a reload.
      void queryClient.invalidateQueries({
        queryKey: ['chief-of-staff', 'cards'],
      })
      pollAttempts.current = 0
      setPendingMeetingDate(null)
    }
  }, [meetings, pendingMeetingDate, queryClient])

  if (!pendingMeetingDate) return null

  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground">
      <span className="relative mt-1 flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-info-600 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-info-600" />
      </span>
      <span>
        Generating your briefing. This takes a few minutes — you can leave this
        page, and we&apos;ll email you when it&apos;s ready.
      </span>
    </div>
  )
}
