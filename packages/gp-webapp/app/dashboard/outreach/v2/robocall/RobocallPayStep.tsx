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
import { formatInTimeZone } from 'date-fns-tz'
import { type RobocallAuthorizeResponse } from '@goodparty_org/contracts'
import { Button, Card } from '@styleguide'
import { ExternalLinkIcon, Loader2Icon } from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { PaymentPortalButton } from '@shared/PaymentPortalButton'
import { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY } from 'appEnv'
import { Intro } from '../social/Intro'

// Opens the existing Stripe billing portal (the same portal-session call the
// account-settings button makes) so a candidate can update or remove a saved
// card without leaving the pay step — the retry-after-decline path and the card
// form both link to it.
const ManagePaymentMethodsButton = () => (
  <PaymentPortalButton variant="link" size="small">
    Manage payment methods
    <ExternalLinkIcon className="ml-2 size-4" />
  </PaymentPortalButton>
)

// Reuses the existing Stripe wiring (the same publishable-key source and
// loadStripe singleton the checkout flow uses) rather than a second one.
const stripePromise = loadStripe(NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)

// Stripe's Appearance API needs concrete values, so the design tokens are read
// from the live cascade with a fallback (mirrors CheckoutPayment).
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

// Dollars from server-derived cents only — the client never computes a money
// figure shown here.
const formatCents = (cents: number): string =>
  (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

// Maps a thrown request status to plain copy — the raw error never reaches the
// candidate. authorize returns hold_failed as a 200 body (not a throw), so
// these cover the create-draft and infrastructure failures around it.
const messageForStatus = (
  status: number | undefined,
  fallback: string,
): string => {
  switch (status) {
    case 400:
      return "Something about this send isn't valid. Go back and check your details."
    case 402:
      return 'Your card was declined. Try another card.'
    case 409:
      return 'This robocall is already being processed.'
    case 502:
      return "We couldn't reach our payment provider. Try again in a moment."
    default:
      return fallback
  }
}

const statusOf = (err: Error | null): number | undefined =>
  err instanceof FetchError ? err.status : undefined

interface RobocallPayStepProps {
  // Everything the server-side draft-create needs, threaded from flow state.
  // The count and amount are NEVER sent — the server re-derives them from the
  // list and returns the estimate this step displays.
  voterFileFilterId: number | null
  audioKey: string | null
  callbackNumber: string | null
  scheduledAt: Date | null
  timeZone: string
  script: string
  campaignName: string
  // The authorize outcome is lifted into the flow so it survives leaving and
  // re-entering this step (Back is the only navigation, and it unmounts us).
  // A settled outcome (authorized/deferred/noop) makes re-entry show the
  // result instead of re-running create-draft + a fresh SetupIntent and
  // re-showing the Authorize form after the hold was already placed.
  outcome: RobocallAuthorizeResponse | null
  onOutcome: (outcome: RobocallAuthorizeResponse | null) => void
}

// A settled outcome is one that must not re-open the payment form on re-entry.
// hold_failed is excluded — the candidate has to be able to retry with another
// card — so it still runs the money calls and shows the retry affordance.
const isSettled = (outcome: RobocallAuthorizeResponse | null): boolean =>
  outcome !== null && outcome.status !== 'hold_failed'

// The pay step (final robocall slice): create the pending_payment draft, vault
// the card via a SetupIntent Payment Element, then place the authorization hold
// and render its outcome. Owns its own submit button (the confirm must run
// inside the Elements context), so the shell renders no footer CTA here.
export const RobocallPayStep = ({
  voterFileFilterId,
  audioKey,
  callbackNumber,
  scheduledAt,
  timeZone,
  script,
  campaignName,
  outcome,
  onOutcome,
}: RobocallPayStepProps) => {
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const startedRef = useRef(false)

  const createDraftMutation = useMutation({
    mutationFn: async () => {
      if (
        voterFileFilterId === null ||
        !audioKey ||
        !callbackNumber ||
        !scheduledAt
      ) {
        throw new Error('missing draft details')
      }
      const { data } = await clientRequest('POST /v1/outreach/robocall', {
        voterFileFilterId,
        audioKey,
        callbackNumber,
        // Offset-annotated (never UTC Z), so the server keeps the local send
        // day — the contract rejects a bare Z.
        scheduledAt: formatInTimeZone(
          scheduledAt,
          timeZone,
          "yyyy-MM-dd'T'HH:mm:ssxxx",
        ),
        ...(script.trim() ? { script } : {}),
        ...(campaignName.trim() ? { name: campaignName } : {}),
      })
      return data
    },
  })
  const { mutate: createDraft } = createDraftMutation

  const cardIntentMutation = useMutation({
    mutationFn: async () => {
      const { data } = await clientRequest(
        'POST /v1/outreach/robocall/save-card-intent',
        {},
      )
      return data
    },
    onSuccess: (data) => setClientSecret(data.clientSecret),
  })
  const { mutate: fetchCardIntent } = cardIntentMutation

  // Fire both once on entering the step: the draft-create returns the estimate
  // to display, the save-card-intent returns the SetupIntent to mount against.
  const hasDetails =
    voterFileFilterId !== null &&
    !!audioKey &&
    !!callbackNumber &&
    !!scheduledAt
  useEffect(() => {
    if (startedRef.current || !hasDetails) return
    // A settled outcome already exists (re-entry after paying): render the
    // result, don't re-run the money calls.
    if (isSettled(outcome)) return
    startedRef.current = true
    createDraft()
    fetchCardIntent()
  }, [hasDetails, outcome, createDraft, fetchCardIntent])

  // Try another card: a fresh SetupIntent so the Payment Element fully remounts
  // (a SetupIntent confirms once), and clear the failed outcome.
  const tryAnotherCard = () => {
    onOutcome(null)
    setClientSecret(null)
    fetchCardIntent()
  }

  const draft = createDraftMutation.data

  const body = () => {
    if (!hasDetails) {
      return (
        <Card className="border-destructive p-4">
          <p className="text-sm text-foreground">
            Some details are missing. Go back and finish each step, then return
            to payment.
          </p>
        </Card>
      )
    }

    if (createDraftMutation.isError) {
      return (
        <Card className="items-start gap-3 border-destructive p-4">
          <p role="alert" className="text-sm text-foreground">
            {messageForStatus(
              statusOf(createDraftMutation.error),
              "We couldn't set up your payment just now. Try again.",
            )}
          </p>
          <Button type="button" size="small" onClick={() => createDraft()}>
            Try again
          </Button>
        </Card>
      )
    }

    if (outcome?.status === 'authorized') {
      return (
        <Card className="gap-1 border-success p-4">
          <p className="text-sm font-medium text-foreground">
            $
            {formatCents(
              outcome.authorizedAmountInCents ?? draft?.amountInCents ?? 0,
            )}{' '}
            authorized
          </p>
          <p className="text-sm text-muted-foreground">
            You&apos;ll be charged for the calls actually placed, never more.
          </p>
        </Card>
      )
    }

    if (outcome?.status === 'deferred') {
      return (
        <Card className="gap-1 p-4">
          <p className="text-sm font-medium text-foreground">
            Your card is saved
          </p>
          <p className="text-sm text-muted-foreground">
            We&apos;ll finish setting up payment closer to your send date.
          </p>
        </Card>
      )
    }

    if (outcome?.status === 'noop') {
      return (
        <Card className="gap-1 p-4">
          <p className="text-sm font-medium text-foreground">
            Payment for this robocall is already set up
          </p>
          <p className="text-sm text-muted-foreground">
            There is nothing more to do here. You can close this window.
          </p>
        </Card>
      )
    }

    if (outcome?.status === 'hold_failed') {
      return (
        <Card className="items-start gap-3 border-destructive p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Your card was declined
            </p>
            <p className="text-sm text-muted-foreground">
              Try a different card to authorize this send.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="small" onClick={tryAnotherCard}>
              Try another card
            </Button>
            <ManagePaymentMethodsButton />
          </div>
        </Card>
      )
    }

    if (cardIntentMutation.isError && !clientSecret) {
      return (
        <Card className="items-start gap-3 border-destructive p-4">
          <p role="alert" className="text-sm text-foreground">
            We couldn&apos;t start a secure payment. Try again.
          </p>
          <Button type="button" size="small" onClick={tryAnotherCard}>
            Try again
          </Button>
        </Card>
      )
    }

    if (!draft || !clientSecret) {
      return (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          Preparing your payment…
        </p>
      )
    }

    return (
      <div className="space-y-6">
        <Card className="p-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Amount to authorize</span>
            <span className="font-semibold text-foreground">
              ${formatCents(draft.amountInCents)}
            </span>
          </div>
        </Card>
        <Elements
          key={clientSecret}
          stripe={stripePromise}
          options={{ clientSecret, appearance: elementsAppearance() }}
        >
          <RobocallPayForm
            outreachId={draft.outreachId}
            amountInCents={draft.amountInCents}
            onOutcome={onOutcome}
          />
        </Elements>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Intro
        channel="robocall"
        title="Payment"
        body="Authorize the estimated cost. You'll only be charged for the calls we actually place."
      />
      {body()}
    </div>
  )
}

interface RobocallPayFormProps {
  outreachId: number
  amountInCents: number
  onOutcome: (outcome: RobocallAuthorizeResponse) => void
}

// The card-entry + authorize form, mounted inside <Elements> so it can confirm
// the SetupIntent. On submit it vaults the card, reads the payment method, then
// places the hold and hands the outcome up.
const RobocallPayForm = ({
  outreachId,
  amountInCents,
  onOutcome,
}: RobocallPayFormProps) => {
  const stripe = useStripe()
  const elements = useElements()
  const [confirming, setConfirming] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // The payment method vaulted by the first successful confirmSetup. A
  // SetupIntent confirms once, so a retry after an authorize FAILURE (a
  // network drop / 5xx, not the hold_failed 200 body) must reuse this and skip
  // re-confirming — re-confirming an already-succeeded SetupIntent errors and
  // would strand the user short of the idempotent server authorize retry.
  const [vaultedPaymentMethodId, setVaultedPaymentMethodId] = useState<
    string | null
  >(null)

  const authorizeMutation = useMutation({
    mutationFn: async (paymentMethodId: string) => {
      const { data } = await clientRequest(
        'POST /v1/outreach/robocall/:outreachId/authorize',
        { outreachId: String(outreachId), paymentMethodId },
      )
      return data
    },
    onSuccess: onOutcome,
    onError: (err) =>
      setSubmitError(
        messageForStatus(
          statusOf(err),
          "We couldn't authorize your card. Try again.",
        ),
      ),
  })

  // One authorize at a time: block a second submit while confirm or authorize
  // is in flight (the money op must not double-fire).
  const pending = confirming || authorizeMutation.isPending

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!stripe || !elements || pending) return
    setSubmitError(null)

    // Confirm only when no card has been vaulted yet; a retry after the card
    // was already vaulted goes straight to the idempotent server authorize.
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

    authorizeMutation.mutate(paymentMethodId)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement options={{ layout: 'tabs' }} />
      {submitError && (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      )}
      <Button
        type="submit"
        size="large"
        className="w-full"
        disabled={!stripe || pending}
        loading={pending}
      >
        Authorize ${formatCents(amountInCents)}
      </Button>
      <div className="flex justify-center">
        <ManagePaymentMethodsButton />
      </div>
    </form>
  )
}
