'use client'

import { useEffect } from 'react'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useContextualPlanPitch } from 'app/dashboard/shared/plan/usePlanPitch'
import { usePlan } from 'app/dashboard/shared/membership/deriveMembershipState'
import { planInterstitialCopy, type GateChannel } from './gateCopy'
import { ProGateDialog } from './ProGateDialog'

interface ProGatePitchProps {
  channel: GateChannel
  // The candidate pressed "Join Pro for $299": the wizard comes next.
  onJoin: () => void
  // The candidate closed it with the X: leave the gate.
  onDismiss: () => void
}

// The "join Pro to send this campaign" pitch a draft save opens over the
// flow's step (win_per_campaign_pricing): the successor to the wizard's
// inline InterstitialStep, which it shares its three events with.
export const ProGatePitch = ({
  channel,
  onJoin,
  onDismiss,
}: ProGatePitchProps): React.JSX.Element => {
  const planPitch = useContextualPlanPitch()
  const { plan } = usePlan()
  const copy = planInterstitialCopy(planPitch)

  useEffect(() => {
    trackEvent(EVENTS.ProUpgrade.Compliance.InterstitialViewed, {
      channel,
      plan,
    })
  }, [channel, plan])

  return (
    <ProGateDialog
      open
      onOpenChange={(open) => {
        if (open) return
        trackEvent(EVENTS.ProUpgrade.Compliance.InterstitialDismissed, {
          channel,
        })
        onDismiss()
      }}
      channel={channel}
      title={copy.title}
      ctaLabel={copy.cta}
      onJoin={() => {
        trackEvent(EVENTS.ProUpgrade.Compliance.InterstitialCompleted, {
          channel,
          plan,
        })
        onJoin()
      }}
    />
  )
}

export default ProGatePitch
