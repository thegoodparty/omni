'use client'

/**
 * Announces a briefing that is currently generating. Presentational: the
 * dispatch and polling live in `useBriefingDispatch`, owned by the dashboard
 * so the task list sees the same state (see that hook's note).
 */
export default function BriefingDispatchBanner({
  inFlight,
}: {
  inFlight: boolean
}): React.JSX.Element | null {
  if (!inFlight) return null

  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground">
      <span className="relative mt-1 flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-info-600 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-info-600" />
      </span>
      <span>
        Generating your briefing. This takes a few minutes. You can leave this
        page, and we&apos;ll email you when it&apos;s ready.
      </span>
    </div>
  )
}
