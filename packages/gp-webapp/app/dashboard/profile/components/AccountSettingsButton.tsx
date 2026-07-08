'use client'

import { PaymentPortalButton } from '@shared/PaymentPortalButton'
import { MdOpenInNew } from 'react-icons/md'
import { Button } from '@styleguide'
import Link from 'next/link'
import { PRO_UPGRADE_ENTRY_PATH } from '@shared/experiments/proUpgrade3Flag'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'

interface AccountSettingsButtonProps {
  isPro: boolean
  // Elected offices never see the Pro upgrade CTA. When elected and not
  // subscribed, no button renders at all.
  isElectedOffice?: boolean
  // Stripe subscription id. A Pro account without one is in a "limbo" state
  // (e.g. mid-cancellation) where the billing portal would error, so the
  // manage-subscription control is hidden until a subscription exists.
  subscriptionId?: string | null
}

export const AccountSettingsButton = ({
  isPro,
  isElectedOffice = false,
  subscriptionId,
}: AccountSettingsButtonProps): React.JSX.Element | null => {
  if (isPro) {
    if (!subscriptionId) {
      return null
    }
    return (
      <PaymentPortalButton>
        Manage Subscription
        <MdOpenInNew className="ml-2" />
      </PaymentPortalButton>
    )
  }

  if (isElectedOffice) {
    return null
  }

  return (
    <div>
      <Button asChild>
        <Link
          href={PRO_UPGRADE_ENTRY_PATH}
          onClick={() => trackEvent(EVENTS.Settings.Account.ClickUpgrade)}
        >
          Upgrade Plan
        </Link>
      </Button>
    </div>
  )
}
