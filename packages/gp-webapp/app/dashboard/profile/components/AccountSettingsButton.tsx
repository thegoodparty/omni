'use client'

import { PaymentPortalButton } from '@shared/PaymentPortalButton'
import { MdOpenInNew } from 'react-icons/md'
import { Button } from '@styleguide'
import Link from 'next/link'
import { proUpgradeHref } from 'app/dashboard/pro-upgrade/proUpgradeAttribution'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'
import { SUPPORT_EMAIL } from '@shared/utils/supportContact'

const UPGRADE_CTA = 'Upgrade Plan'

interface AccountSettingsButtonProps {
  isPro: boolean
  // Elected offices never see the Pro upgrade CTA. When elected and not
  // subscribed, no button renders at all.
  isElectedOffice?: boolean
  // Stripe subscription id from the campaign. It can be missing on a paying
  // account (lost write, pre-ENG-11084 checkout), so it is not the only gate.
  subscriptionId?: string | null
  // Stripe customer id from the user. The billing portal needs only this (the
  // API also recovers it from the campaign), so it also opens the portal.
  customerId?: string | null
}

export const AccountSettingsButton = ({
  isPro,
  isElectedOffice = false,
  subscriptionId,
  customerId,
}: AccountSettingsButtonProps): React.JSX.Element | null => {
  if (isPro) {
    if (!subscriptionId && !customerId) {
      // Nothing to open a portal with: point at support instead of a blank
      // space, so a paying user is never stranded (ENG-11597).
      return (
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="text-sm text-muted-foreground underline"
        >
          Contact support to manage your subscription
        </a>
      )
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
          href={proUpgradeHref({
            source: 'account_settings',
            channel: 'generic',
            cta: UPGRADE_CTA,
          })}
          onClick={() => trackEvent(EVENTS.Settings.Account.ClickUpgrade)}
        >
          {UPGRADE_CTA}
        </Link>
      </Button>
    </div>
  )
}
