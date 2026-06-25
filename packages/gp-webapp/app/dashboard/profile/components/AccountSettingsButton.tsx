'use client'

import { PaymentPortalButton } from '@shared/PaymentPortalButton'
import { MdOpenInNew } from 'react-icons/md'
import { Button } from '@styleguide'
import Link from 'next/link'
import { PRO_UPGRADE_ENTRY_PATH } from '@shared/experiments/proUpgrade3Flag'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'

interface AccountSettingsButtonProps {
  isPro: boolean
}

export const AccountSettingsButton = ({
  isPro,
}: AccountSettingsButtonProps): React.JSX.Element => {
  return isPro ? (
    <PaymentPortalButton>
      Manage Subscription
      <MdOpenInNew className="ml-2" />
    </PaymentPortalButton>
  ) : (
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
