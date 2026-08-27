'use client'

import { Card } from '@styleguide'
import { ExternalLinkIcon } from '@styleguide/components/ui/icons'
import { PaymentPortalButton } from '@shared/PaymentPortalButton'
import { useVoterOutreachV2RobocallFlag } from '@shared/experiments/voterOutreachV2RobocallFlag'
import { EVENTS } from 'helpers/analyticsHelper'
import { User } from 'helpers/types'

interface PaymentMethodCardProps {
  user: User
}

// Robocall prepay saves a card against a Stripe customer, so this entry only
// makes sense once that customer exists — the portal-session endpoint 400s
// without a customerId. Gate on both the flag and a stored customerId so a
// user with nothing to manage never sees a control that would only error.
export const PaymentMethodCard = ({
  user,
}: PaymentMethodCardProps): React.JSX.Element | null => {
  const { ready, enabled } = useVoterOutreachV2RobocallFlag()

  if (!ready || !enabled || !user.metaData?.customerId) {
    return null
  }

  return (
    <Card className="w-full max-w-[640px] gap-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="m-0 text-xl font-semibold text-foreground">
          Payment method
        </h2>
        <PaymentPortalButton
          analyticsEvent={EVENTS.Settings.Account.ManagePaymentMethod}
        >
          Manage payment method
          <ExternalLinkIcon className="ml-2 size-4" />
        </PaymentPortalButton>
      </div>

      <p className="m-0 text-sm text-muted-foreground">
        View or remove the card saved to your account.
      </p>
    </Card>
  )
}
