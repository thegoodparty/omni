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
}

export const AccountSettingsButton = ({
  isPro,
  isElectedOffice = false,
}: AccountSettingsButtonProps): React.JSX.Element | null => {
  if (isPro) {
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
