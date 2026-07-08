'use client'
import React, { ReactNode, MouseEvent, useState, ComponentProps } from 'react'
import Link from 'next/link'
import { Button } from '@styleguide'
import { clientFetch } from 'gpApi/clientFetch'
import { apiRoutes } from 'gpApi/routes'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'

interface PaymentPortalButtonProps extends Omit<
  ComponentProps<typeof Button>,
  'children'
> {
  redirectUrl?: string | null
  children: ReactNode
}

export const PaymentPortalButton = ({
  redirectUrl = null,
  children,
  ...restProps
}: PaymentPortalButtonProps): React.JSX.Element => {
  const [loading, setLoading] = useState(false)

  const onClick = async (e: MouseEvent<HTMLButtonElement>): Promise<void> => {
    e.preventDefault()
    trackEvent(EVENTS.Settings.Account.ClickManageSubscription)
    setLoading(true)
    // A failed portal request must re-enable the button: on the post-election
    // gated screen this button is the user's only path to the Stripe portal,
    // so a stuck disabled state would strand them with no recovery.
    try {
      const resp = await clientFetch<{ redirectUrl: string }>(
        apiRoutes.payments.createPortalSession,
      )
      const portalRedirectUrl = resp.data?.redirectUrl
      if (!portalRedirectUrl) {
        throw new Error('No portal redirect url found')
      }
      window.location.href = portalRedirectUrl
    } catch (error) {
      console.error('Error creating billing portal session:', error)
    } finally {
      setLoading(false)
    }
  }

  if (redirectUrl) {
    return (
      <Button asChild className="flex items-center" {...restProps}>
        <Link href={redirectUrl}>{children}</Link>
      </Button>
    )
  }

  return (
    <Button
      className="flex items-center"
      disabled={loading}
      onClick={onClick}
      {...restProps}
    >
      {children}
    </Button>
  )
}
