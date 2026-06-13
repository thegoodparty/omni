'use client'

import { PaymentPortalButton } from '@shared/PaymentPortalButton'
import { MdOpenInNew } from 'react-icons/md'
import { Button } from '@styleguide'
import Link from 'next/link'
import { useProUpgradeEntryHref } from '@shared/experiments/proUpgrade3Flag'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'

interface AccountSettingsButtonProps {
  isPro: boolean
}

export const AccountSettingsButton = ({
  isPro,
}: AccountSettingsButtonProps): React.JSX.Element => {
  // pro-upgrade3 cohort enters the new wizard; off-cohort keeps the legacy
  // pro-sign-up flow.
  const { href: upgradeHref } = useProUpgradeEntryHref('/dashboard/pro-sign-up')

  return isPro ? (
    <PaymentPortalButton>
      Manage Subscription
      <MdOpenInNew className="ml-2" />
    </PaymentPortalButton>
  ) : (
    <div>
      <Button asChild>
        <Link
          href={upgradeHref}
          onClick={() => trackEvent(EVENTS.Settings.Account.ClickUpgrade)}
        >
          Upgrade Plan
        </Link>
      </Button>
    </div>
  )
}
