'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { FetchError } from 'ofetch'
import type { PaymentHoldCardResponse } from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { extractApiErrorInfo } from 'helpers/extractApiErrorInfo'
import { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY } from 'appEnv'

const stripePromise = loadStripe(NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)

const cssColor = (name: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return value || fallback
}

const elementsAppearance = () => ({
  variables: {
    colorPrimary: cssColor('--color-primary', '#2f42f6'),
    colorText: cssColor('--color-foreground', '#000000'),
    colorDanger: cssColor('--color-destructive', '#E00C30'),
    fontFamily: "'Open Sans', sans-serif",
    borderRadius: '8px',
  },
})

export type PaymentHoldCardMode = 'win' | 'serve'

export type PaymentHoldCardSuccess = Exclude<
  PaymentHoldCardResponse,
  { outcome: 'declined' }
>

const DECLINE_MESSAGES: Record<string, string> = {
  insufficient_funds: "That card doesn't have enough available. Try another.",
  expired_card: 'That card has expired. Try another.',
  incorrect_cvc: "The security code didn't match. Check it or try another.",
  requires_action: 'Your bank needs to approve this card. Try another.',
}

const DECLINE_FALLBACK = 'Your card was declined. Try another card.'

const isStillPlacing = (message: string | undefined): boolean =>
  !!message && /still being placed|try again/.test(message)

const messageForError = (err: Error | null): string => {
  const status = err instanceof FetchError ? err.status : undefined
  switch (status) {
    case 400:
      return "We couldn't use that card for this send. Try another card."
    case 404:
      return "We couldn't find this send."
    case 409:
      return isStillPlacing(
        err instanceof FetchError
          ? extractApiErrorInfo(err.data).message
          : undefined,
      )
        ? "We're still finishing your last try. Wait a minute, then try again."
        : "This send can't take a new card anymore."
    case 502:
      return "We couldn't reach our payment provider. Try again in a moment."
    default:
      return "We couldn't save your card. Try again."
  }
}

interface PaymentHoldCardProps {
  mode: PaymentHoldCardMode
  outreachId: number
  submitLabel: string
  // Saves every card, retries after a decline included, through the caller's
  // own call (a channel's confirm, which keeps a declined send a draft). Left
  // out, the card goes to the send's existing hold.
  savePaymentMethod?: (
    paymentMethodId: string,
  ) => Promise<PaymentHoldCardResponse>
  onOutcome: (outcome: PaymentHoldCardSuccess) => void
}

export const PaymentHoldCard = ({
  mode,
  outreachId,
  submitLabel,
  savePaymentMethod,
  onOutcome,
}: PaymentHoldCardProps) => {
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [declineCode, setDeclineCode] = useState<string | null | undefined>(
    undefined,
  )
  const startedRef = useRef(false)

  const cardIntentMutation = useMutation({
    mutationFn: async () => {
      const { data } = await clientRequest(
        mode === 'serve'
          ? 'POST /v1/outreach/serve/holds/card-intent'
          : 'POST /v1/outreach/holds/card-intent',
        {},
      )
      return data
    },
    onSuccess: (data) => setClientSecret(data.clientSecret),
  })
  const { mutate: fetchCardIntent } = cardIntentMutation

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    fetchCardIntent()
  }, [fetchCardIntent])

  // A SetupIntent confirms once, so another card needs a fresh one and a
  // freshly mounted Payment Element.
  const tryAnotherCard = () => {
    setDeclineCode(undefined)
    setClientSecret(null)
    fetchCardIntent()
  }

  const handleResult = (result: PaymentHoldCardResponse) => {
    if (result.outcome === 'declined') {
      setDeclineCode(result.declineCode)
      return
    }
    onOutcome(result)
  }

  if (declineCode !== undefined) {
    return (
      <div className="space-y-4">
        <p role="alert" className="text-sm text-destructive">
          {(declineCode && DECLINE_MESSAGES[declineCode]) || DECLINE_FALLBACK}
        </p>
        <Button
          type="button"
          size="large"
          className="w-full"
          onClick={tryAnotherCard}
        >
          Use a different card
        </Button>
      </div>
    )
  }

  if (cardIntentMutation.isError) {
    return (
      <div className="space-y-4">
        <p role="alert" className="text-sm text-destructive">
          We couldn&apos;t load the card form. Try again.
        </p>
        <Button
          type="button"
          size="large"
          className="w-full"
          onClick={tryAnotherCard}
        >
          Try again
        </Button>
      </div>
    )
  }

  if (!clientSecret) return null

  return (
    <Elements
      key={clientSecret}
      stripe={stripePromise}
      options={{ clientSecret, appearance: elementsAppearance() }}
    >
      <PaymentHoldCardForm
        mode={mode}
        outreachId={outreachId}
        submitLabel={submitLabel}
        savePaymentMethod={savePaymentMethod}
        onResult={handleResult}
        onUseDifferentCard={tryAnotherCard}
      />
    </Elements>
  )
}

interface PaymentHoldCardFormProps {
  mode: PaymentHoldCardMode
  outreachId: number
  submitLabel: string
  savePaymentMethod?: PaymentHoldCardProps['savePaymentMethod']
  onResult: (result: PaymentHoldCardResponse) => void
  onUseDifferentCard: () => void
}

const PaymentHoldCardForm = ({
  mode,
  outreachId,
  submitLabel,
  savePaymentMethod,
  onResult,
  onUseDifferentCard,
}: PaymentHoldCardFormProps) => {
  const stripe = useStripe()
  const elements = useElements()
  const [confirming, setConfirming] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // A SetupIntent confirms once. If saving fails after the card is vaulted,
  // the retry reuses this card instead of confirming again.
  const [vaultedPaymentMethodId, setVaultedPaymentMethodId] = useState<
    string | null
  >(null)

  const saveMutation = useMutation({
    mutationFn: async (paymentMethodId: string) => {
      if (savePaymentMethod) return savePaymentMethod(paymentMethodId)
      const { data } = await clientRequest(
        mode === 'serve'
          ? 'POST /v1/outreach/serve/holds/:outreachId/card'
          : 'POST /v1/outreach/holds/:outreachId/card',
        { outreachId: String(outreachId), paymentMethodId },
      )
      return data
    },
    onSuccess: onResult,
    onError: (err) => setSubmitError(messageForError(err)),
  })

  const pending = confirming || saveMutation.isPending

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!stripe || !elements || pending) return
    setSubmitError(null)

    let paymentMethodId = vaultedPaymentMethodId
    if (!paymentMethodId) {
      setConfirming(true)
      const result = await stripe.confirmSetup({
        elements,
        redirect: 'if_required',
      })
      setConfirming(false)
      if (result.error) {
        setSubmitError(
          result.error.message ??
            "We couldn't save your card. Check your details and try again.",
        )
        return
      }
      const method = result.setupIntent?.payment_method
      paymentMethodId =
        typeof method === 'string' ? method : (method?.id ?? null)
      if (!paymentMethodId) {
        setSubmitError("We couldn't read your saved card. Try again.")
        return
      }
      setVaultedPaymentMethodId(paymentMethodId)
    }

    saveMutation.mutate(paymentMethodId)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Link can vault a bank account, and a bank account cannot back a
          manual-capture hold. */}
      <PaymentElement
        options={{ layout: 'tabs', wallets: { link: 'never' } }}
      />
      {submitError && (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      )}
      {submitError && vaultedPaymentMethodId && (
        <Button type="button" variant="link" onClick={onUseDifferentCard}>
          Use a different card
        </Button>
      )}
      <Button
        type="submit"
        size="large"
        className="w-full"
        disabled={!stripe || pending}
        loading={pending}
      >
        {submitLabel}
      </Button>
    </form>
  )
}
