'use client'

import { useUser } from '@shared/hooks/useUser'
import { useProUpgrade3Flag } from '@shared/experiments/proUpgrade3Flag'
import { CompleteProSignUpAlert } from './CompleteProSignUpAlert'
import { PendingProSubscriptionAlert } from './PendingProSignUpAlert'
import { Campaign } from 'helpers/types'

interface AlertSectionProps {
  campaign: Campaign
}

export default function AlertSection(
  props: AlertSectionProps,
): React.JSX.Element {
  const [user] = useUser()
  const { metaData: userMetaData } = user || {}
  const { checkoutSessionId, customerId } = userMetaData || {}
  const { ready, enabled: proUpgrade3Enabled } = useProUpgrade3Flag()

  const { campaign } = props
  const { isPro, details } = campaign
  const { subscriptionId } = details || {}

  const startedProCheckout = checkoutSessionId && !customerId && !subscriptionId
  const subscriptionPending = checkoutSessionId && customerId && !subscriptionId

  // The pro-upgrade3 cohort runs the new wizard + ProUpgradeBanner and must
  // never see the legacy pro-sign-up alerts. Wait for the flag to resolve so
  // cohort users don't flash the old banner before it's known they're in.
  const inLegacyCohort = ready && !proUpgrade3Enabled

  const showCompleteProSignUpAlert = inLegacyCohort && startedProCheckout
  const showSubscriptionPendingAlert = inLegacyCohort && subscriptionPending

  return (
    <div>
      {!isPro && (
        <>
          {showCompleteProSignUpAlert && <CompleteProSignUpAlert />}
          {showSubscriptionPendingAlert && <PendingProSubscriptionAlert />}
        </>
      )}
    </div>
  )
}
