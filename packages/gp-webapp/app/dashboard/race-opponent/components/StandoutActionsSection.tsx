'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@styleguide'
import { SendIcon } from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useCampaign } from '@shared/hooks/useCampaign'
import type { RaceOpponentStandoutAction } from 'gpApi/api-endpoints'

type Props = {
  standoutActions: RaceOpponentStandoutAction[] | null | undefined
}

// The "N ways to stand out" action cards below the field SWOT (ENG-10650).
// Each card carries an agent-drafted SMS; the CTA deep-links into the outreach
// text composer with that message preset (`compose=text&message=...`), which
// applies the same Pro/compliance gates as the manual path. Renders nothing
// while the actions run is still in flight or after it failed (empty/absent
// standoutActions) — the brief simply ends at the SWOT.
const StandoutActionsSection = ({
  standoutActions,
}: Props): React.JSX.Element | null => {
  const router = useRouter()
  const [campaign] = useCampaign()

  const actionCount = standoutActions?.length ?? 0
  // Fire the viewed event once per mount, only when cards actually render. The
  // parent polls every 5s, so without the ref an unguarded effect would re-fire
  // on every tick's fresh array reference.
  const viewedRef = useRef(false)
  useEffect(() => {
    if (actionCount === 0 || viewedRef.current) return
    viewedRef.current = true
    trackEvent(EVENTS.RaceOpponent.StandoutActionsViewed, {
      campaignId: campaign?.id,
      actionCount,
    })
  }, [actionCount, campaign?.id])

  if (!standoutActions || standoutActions.length === 0) return null

  const handleSendSms = (
    action: RaceOpponentStandoutAction,
    index: number,
  ): void => {
    trackEvent(EVENTS.RaceOpponent.StandoutActionClicked, {
      campaignId: campaign?.id,
      order: index,
      issue: action.issue,
      ...(action.opponentName != null && {
        opponentName: action.opponentName,
      }),
      messageLength: action.smsMessage.length,
    })
    router.push(
      `/dashboard/outreach?compose=text&message=${encodeURIComponent(action.smsMessage)}`,
    )
  }

  return (
    <section className="mx-auto mt-4 w-full max-w-[608px]">
      <h2 className="text-lg font-semibold text-foreground">
        {standoutActions.length} {standoutActions.length === 1 ? 'way' : 'ways'}{' '}
        to stand out
      </h2>
      <p className="text-sm text-muted-foreground">
        These actions will help you show voters where you stand out against the
        opposition.
      </p>
      <div className="mt-4 flex flex-col gap-4">
        {standoutActions.map((action, index) => (
          <div
            key={`${action.title}-${index}`}
            className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 md:p-6"
          >
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary">
              <SendIcon className="h-4 w-4" aria-hidden />
              Voter outreach
            </span>
            <h3 className="min-w-0 break-words text-lg font-semibold text-foreground">
              {action.title}
            </h3>
            <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
              {action.body}
            </p>
            <Button
              className="w-full"
              onClick={() => handleSendSms(action, index)}
            >
              Send SMS to voters
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}

export default StandoutActionsSection
