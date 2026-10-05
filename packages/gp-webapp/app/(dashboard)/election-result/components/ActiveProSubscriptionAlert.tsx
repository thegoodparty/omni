// No 'use client': both consumers (the election-result gate page and the loss
// page) are already client components, so this stays out of the guarded
// use-client count without changing the bundle boundary.
import {
  Alert,
  AlertDescription,
  AlertAction,
} from '@styleguide/components/ui/alert'
import { InfoIcon } from '@styleguide/components/ui/icons'
import { PaymentPortalButton } from '@shared/PaymentPortalButton'
import { useCampaign } from '@shared/hooks/useCampaign'

// The post-election gate blocks every dashboard route (including the profile
// page's "Manage Subscription" button), so a Pro candidate whose race ended is
// otherwise left with no way to reach their Stripe billing portal while still
// being charged. Surface the portal here — the only screen they can see.
export const ActiveProSubscriptionAlert = ({
  className,
}: {
  className?: string
}): React.JSX.Element | null => {
  const [campaign] = useCampaign()
  const { isPro, details } = campaign || {}
  const { subscriptionId, subscriptionCancelAt } = details || {}

  const hasActiveSubscription =
    Boolean(isPro) && Boolean(subscriptionId) && !subscriptionCancelAt

  if (!hasActiveSubscription) {
    return null
  }

  return (
    <Alert variant="info" icon={<InfoIcon />} className={className}>
      <AlertDescription>
        Your Pro subscription is still active and will keep renewing until you
        cancel it.
      </AlertDescription>
      <AlertAction>
        <PaymentPortalButton variant="alertFilled" size="small">
          Manage subscription
        </PaymentPortalButton>
      </AlertAction>
    </Alert>
  )
}
