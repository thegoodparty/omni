'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'

const POLL_INTERVAL_MS = 5000
const MAX_POLL_ATTEMPTS = 60 // 5s x 60 = 5 min ceiling

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
  const [pollAttempts, setPollAttempts] = useState(0)

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
    const nextAttempts = pollAttempts + 1
    if (meeting?.hasBriefing || nextAttempts >= MAX_POLL_ATTEMPTS) {
      setPendingMeetingDate(null)
      setPollAttempts(0)
    } else {
      setPollAttempts(nextAttempts)
    }
  }, [meetings, pendingMeetingDate, pollAttempts])

  if (!pendingMeetingDate) return null

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-info-600 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-info-600" />
      </span>
      Generating your briefing...
    </div>
  )
}
