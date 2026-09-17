import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@styleguide'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { DistrictStatsUnavailableReason } from './queries'

// Every polls surface that can hard-block on missing constituent data renders
// this, so the copy and the analytics event can't drift between them. Callers
// keep their own chrome (FormStep, ExpandPollLayout, the onboarding section)
// and drop this inside it.
export const ConstituentDataUnavailable: React.FC<{
  reason: DistrictStatsUnavailableReason
  source: 'onboarding' | 'create' | 'expand'
  // What the poll can't do without the data — "sent" or "expanded".
  blockedAction: string
  onRetry: () => void
}> = ({ reason, source, blockedAction, onRetry }) => {
  const router = useRouter()

  useEffect(() => {
    trackEvent(EVENTS.Polls.ConstituentDataUnavailableViewed, {
      source,
      reason,
    })
  }, [reason, source])

  // A request that kept failing is not a data gap: the office's data may be
  // perfectly fine. Saying "we don't have it" would be false, and routing to
  // Contacts sends the user somewhere nobody can help — the only useful
  // affordance is to try again.
  if (reason === 'stats_error') {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <h2 className="text-xl font-semibold">
          We couldn&apos;t load your constituent data
        </h2>
        <p className="text-muted-foreground">
          Something went wrong on our end. Try again in a moment.
        </p>
        <Button onClick={onRetry}>Try again</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <h2 className="text-xl font-semibold">
        We don&apos;t have constituent data for this office yet
      </h2>
      <p className="text-muted-foreground">
        A poll can&apos;t be {blockedAction} without it. Visit Contacts and our
        team can set this up for you.
      </p>
      <Button onClick={() => router.push('/dashboard/contacts')}>
        Visit Contacts
      </Button>
    </div>
  )
}
