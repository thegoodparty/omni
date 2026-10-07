'use client'

import { ReactNode } from 'react'
import { CheckoutProvider } from '@stripe/react-stripe-js/checkout'
import { loadStripe } from '@stripe/stripe-js'
import CheckoutForm from './CheckoutForm'
import { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY } from 'appEnv'
import { useCheckoutSession } from './CheckoutSessionProvider'

const stripePromise = loadStripe(NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)

// Stripe's Appearance API needs concrete color values, so the design tokens
// are resolved from the live cascade (SSR falls back to the token defaults).
const cssColor = (name: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return value || fallback
}

// Embedded checkout styled to the design system: token colors, the app's
// Open Sans (served to Stripe's iframes via cssSrc), 8px radii, semibold
// labels — per the voter outreach pay-step decision; every custom-session
// consumer (text outreach now, robocall in phase 3) shares this look.
const elementsOptions = () => ({
  fonts: [
    {
      cssSrc:
        'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600&display=swap',
    },
  ],
  appearance: {
    variables: {
      colorPrimary: cssColor('--color-primary', '#2f42f6'),
      colorText: cssColor('--color-foreground', '#000000'),
      colorTextSecondary: cssColor('--color-muted-foreground', '#70757A'),
      colorDanger: cssColor('--color-destructive', '#E00C30'),
      fontFamily: "'Open Sans', sans-serif",
      borderRadius: '8px',
    },
    rules: {
      '.Label': {
        fontWeight: '600',
        color: cssColor('--color-foreground', '#000000'),
      },
    },
  },
})

export type CheckoutPaymentProps = {
  onPaymentSuccess?: (sessionId: string) => void
  // Used when there is no Stripe session id client-side (the Pro subscription),
  // where fulfillment happens via the webhook and the form just confirms.
  onPaymentConfirmed?: () => void | Promise<void>
  onPaymentError?: (errorMessage: string) => void
  submitLabel?: string
  // Lays out chrome around the form (card, order summary) inside the
  // CheckoutProvider so it can read the live total via Stripe's useCheckout —
  // e.g. the Pro plan payment step.
  renderLayout?: (form: ReactNode) => ReactNode
}

const CheckoutPayment: React.FC<CheckoutPaymentProps> = ({
  onPaymentSuccess,
  onPaymentConfirmed,
  onPaymentError,
  submitLabel,
  renderLayout,
}) => {
  const { checkoutSession } = useCheckoutSession()

  if (!checkoutSession?.clientSecret) return null

  const form = (
    <CheckoutForm
      onSuccess={onPaymentSuccess}
      onConfirmed={onPaymentConfirmed}
      onError={onPaymentError}
      sessionId={checkoutSession.id}
      submitLabel={submitLabel}
    />
  )

  return (
    <CheckoutProvider
      stripe={stripePromise}
      options={{
        clientSecret: checkoutSession.clientSecret,
        elementsOptions: elementsOptions(),
      }}
    >
      {renderLayout ? renderLayout(form) : form}
    </CheckoutProvider>
  )
}

export default CheckoutPayment
