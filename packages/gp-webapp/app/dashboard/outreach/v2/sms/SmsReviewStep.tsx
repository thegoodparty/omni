'use client'

import { useEffect, useRef, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  cn,
} from '@styleguide'
import {
  CircleAlertIcon,
  EyeIcon,
  GiftIcon,
  InfoIcon,
  Loader2Icon,
  MessageSquareIcon,
} from '@styleguide/components/ui/icons'
import { useCampaign } from '@shared/hooks/useCampaign'
import CheckoutPayment from 'app/dashboard/purchase/components/CheckoutPayment'
import PurchaseError from 'app/dashboard/purchase/components/PurchaseError'
import { useCheckoutSession } from 'app/dashboard/purchase/components/CheckoutSessionProvider'
import {
  completeCheckoutSession,
  completeFreePurchase,
} from 'app/dashboard/purchase/utils/purchaseFetch.utils'
import { Spinner } from '@styleguide'
import { FREE_TEXTS_OFFER } from 'app/dashboard/outreach/constants'
import { PURCHASE_TYPES } from 'helpers/purchaseTypes'
import { z } from 'zod'
import { Intro } from '../social/Intro'
import { SMS_GREETING_PREVIEW, withSampleFirstName } from './smsCompose.util'

// A 400 from complete-free-purchase carries a user-fixable message (e.g.
// Peerly rejecting a banned link in the script) worth showing verbatim.
const purchaseErrorSchema = z.object({
  statusCode: z.literal(400),
  message: z.string(),
})

// The checkout-session endpoint returns amount in DOLLARS
// (stripe.service.ts divides amount_total by 100).
const money = (dollars: number): string => dollars.toFixed(2)

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

interface SmsReviewStepProps {
  // Display only. Serve's greeting carries a merge token fulfilment fills
  // per recipient, so the bubble shows a stand-in name instead of the token
  // — the script sent to the API is untouched.
  isServe: boolean
  name: string
  audienceName: string
  sendAt: Date
  // The campaign's zone for a Win send (the instant was built in it);
  // omitted for Serve, whose fixed-hour stamp is browser-local.
  timeZone?: string
  composedMessage: string
  imagePreviewUrl: string | null
  // Null only in build mode, where the reach count comes from the
  // recommendation the candidate picked and may not be known at all. The
  // rows it feeds are omitted rather than printed as 0.
  contactCount: number | null
  pricePerContact: number
  outreachId: number | null
  phoneListToken: string | null
  // The PeerlyPhoneList row id, carried alongside the token so an async build
  // (no token yet) can still complete a free send off the build id. Sent to
  // gp-api only when there is no token — the token path is unchanged.
  phoneListBuildId: string | null
  excludedOptedOutCount: number | null
  excludedDuplicatePhoneCount: number | null
  // Pay-before-ready (Win SMS hold billing): the total is the pre-pay estimate,
  // a ceiling the capture bills down to the actual reachable list — so the pay
  // card states the price as a ceiling instead of a flat charge.
  priceIsCeiling?: boolean
  // Draft creation happens in the flow; until it lands there is no session
  // to fetch, so the pay card shows a preparing state.
  preparing: boolean
  prepareError: boolean
  // The phone-list build itself (not the draft-creation step `prepareError`
  // covers) resolved to `failed` — distinct because the fix is different:
  // there's a fresh build to request, not a draft to retry.
  buildFailed?: boolean
  retryingBuild?: boolean
  onRetryBuild?: () => void
  // The candidate cannot send yet (milestone 2's gate), so this reads back
  // what they built with no schedule rows and no checkout — the flow's own
  // CTA saves it as a draft instead (design: flowReview's preClear branch).
  readOnlySummary?: boolean
  // paid=false on the free-texts redemption path — the success screen only
  // fetches a Stripe receipt for a real charge.
  onComplete: (paid: boolean) => Promise<void>
}

export const SmsReviewStep = ({
  isServe,
  name,
  audienceName,
  sendAt,
  timeZone,
  composedMessage,
  imagePreviewUrl,
  contactCount,
  pricePerContact,
  outreachId,
  phoneListToken,
  phoneListBuildId,
  excludedOptedOutCount,
  excludedDuplicatePhoneCount,
  priceIsCeiling = false,
  preparing,
  prepareError,
  buildFailed = false,
  retryingBuild = false,
  onRetryBuild,
  readOnlySummary = false,
  onComplete,
}: SmsReviewStepProps) => {
  const [campaign] = useCampaign()
  const { checkoutSession, error, setError, fetchClientSecret } =
    useCheckoutSession()
  const [preview, setPreview] = useState(false)
  const [isRedeeming, setIsRedeeming] = useState(false)
  const [payError, setPayError] = useState(false)
  const [payErrorMessage, setPayErrorMessage] = useState<string | null>(null)
  // What Stripe is actually charging once the form has priced the session,
  // which is the only figure that reflects an applied promo code. Null until
  // the form reports it, so the summary falls back to the session amount.
  const [liveTotalDollars, setLiveTotalDollars] = useState<number | null>(null)
  // A declined or failed card confirm. The form stays mounted so the
  // candidate can try another card on the same session; swapping in the
  // purchase-error card read as "Failed to initialize purchase" and forced a
  // Back that minted a new draft and session (Dujuan Thomas, 2026-10-06).
  const [cardError, setCardError] = useState<string | null>(null)
  const isRedeemingRef = useRef(false)
  const hasFetchedSession = useRef(false)

  const hasFreeTextsOffer = Boolean(campaign?.hasFreeTextsOffer)
  const isFree =
    checkoutSession?.amount === 0 ||
    (hasFreeTextsOffer &&
      contactCount !== null &&
      contactCount <= FREE_TEXTS_OFFER.COUNT)
  const totalDollars = isFree
    ? 0
    : (liveTotalDollars ?? checkoutSession?.amount ?? 0)
  // The provider's error is set both when the session could not be created
  // and, by the form, when a confirm fails. Only the first is fatal to the
  // step; once a session exists an error is a card problem to show inline.
  const sessionError = Boolean(error) && !checkoutSession
  const inlineCardError = cardError ?? (checkoutSession ? error : null)
  // No checkout session exists before the draft is saved, so the total is
  // the same estimate the audience step priced.
  const summaryDollars =
    contactCount === null ? null : isFree ? 0 : contactCount * pricePerContact

  useEffect(() => {
    if (readOnlySummary || !outreachId || hasFetchedSession.current) return
    hasFetchedSession.current = true
    fetchClientSecret().catch(() => {
      // Surfaced through the provider's error state below.
    })
  }, [outreachId, fetchClientSecret, readOnlySummary])

  const handleFreeComplete = async () => {
    if (isRedeemingRef.current) return
    isRedeemingRef.current = true
    setIsRedeeming(true)
    try {
      const response = await completeFreePurchase(PURCHASE_TYPES.TEXT, {
        contactCount: contactCount ?? 0,
        pricePerContact,
        outreachType: 'p2p',
        outreachId: outreachId ?? undefined,
        phoneListToken: phoneListToken ?? undefined,
        // Async build: with no token the server resolves the list by build id.
        // Sent only when the token is absent, so the token path is unchanged.
        ...(phoneListToken
          ? {}
          : { phoneListBuildId: phoneListBuildId ?? undefined }),
      })
      if (!response.ok) {
        const parsed = purchaseErrorSchema.safeParse(response.data)
        setPayErrorMessage(parsed.success ? parsed.data.message : null)
        setPayError(true)
        return
      }
      await onComplete(false)
    } catch {
      setPayErrorMessage(null)
      setPayError(true)
    } finally {
      isRedeemingRef.current = false
      setIsRedeeming(false)
    }
  }

  const handlePaidComplete = async (sessionId: string) => {
    // Reached only after Stripe confirmed the card, so a decline shown from
    // an earlier attempt is stale while the flow moves to the success screen.
    setCardError(null)
    setError(null)
    const response = await completeCheckoutSession(sessionId)
    if (!response.ok) {
      const parsed = purchaseErrorSchema.safeParse(response.data)
      if (parsed.success) {
        setPayErrorMessage(parsed.data.message)
        setPayError(true)
        return
      }
      // The card is already charged, so this is not a card problem: show the
      // purchase error card, not the inline decline. The throw stays so
      // CheckoutForm's onError still reports to Sentry and snackbars.
      setPayError(true)
      throw new Error('Failed to complete purchase')
    }
    await onComplete(true)
  }

  return (
    <div className="space-y-6">
      <Intro
        title={
          readOnlySummary
            ? 'Review and verify'
            : isFree
              ? 'Review and send'
              : 'Review & pay'
        }
        body={
          readOnlySummary
            ? 'Review your campaign details, then verify your campaign so this can send.'
            : isFree
              ? 'Review your campaign details and schedule your send.'
              : 'Review your campaign details and complete your payment.'
        }
      />

      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex items-center gap-3 px-4 py-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-info-light">
            <MessageSquareIcon className="size-6 text-foreground" />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-foreground">SMS</p>
            <p className="truncate text-sm text-muted-foreground">{name}</p>
          </div>
        </div>
        <div className="border-t border-border px-4 py-4">
          <dl className="space-y-1.5 text-sm">
            {!readOnlySummary && (
              <>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Send date</dt>
                  <dd className="text-foreground">
                    {timeZone
                      ? formatInTimeZone(sendAt, timeZone, 'EEE, MMM d, yyyy')
                      : fmtDate(sendAt)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Send time</dt>
                  <dd className="text-foreground">
                    {timeZone
                      ? formatInTimeZone(sendAt, timeZone, 'h:mm a')
                      : sendAt.toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                  </dd>
                </div>
              </>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Audience</dt>
              <dd className="truncate text-foreground">{audienceName}</dd>
            </div>
            {contactCount !== null && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">People</dt>
                <dd className="text-foreground">
                  {contactCount.toLocaleString()}
                </dd>
              </div>
            )}
            {!!excludedOptedOutCount && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Excluded (opted out)</dt>
                <dd className="text-muted-foreground">
                  {excludedOptedOutCount.toLocaleString()}
                </dd>
              </div>
            )}
            {!!excludedDuplicatePhoneCount && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  Duplicate numbers removed
                </dt>
                <dd className="text-muted-foreground">
                  {excludedDuplicatePhoneCount.toLocaleString()}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Price per outreach</dt>
              <dd className="text-foreground">${pricePerContact.toFixed(3)}</dd>
            </div>
            {hasFreeTextsOffer && (
              <div className="flex items-center gap-2 pt-1 text-link">
                <GiftIcon className="size-4" />
                <span className="text-sm font-medium">
                  {FREE_TEXTS_OFFER.COUNT.toLocaleString()} free texts included
                </span>
              </div>
            )}
          </dl>
        </div>
        {/* A build-mode summary with no count has no total to state, and a
            fabricated $0.00 would read as "free". */}
        <div
          className="flex items-center justify-between border-t border-border px-4 py-4"
          hidden={readOnlySummary && summaryDollars === null}
        >
          <span className="font-medium text-foreground">Total</span>
          <span className="font-semibold text-foreground">
            {readOnlySummary ? (
              summaryDollars !== null && summaryDollars > 0 ? (
                `$${money(summaryDollars)}`
              ) : (
                'Free'
              )
            ) : prepareError || buildFailed || sessionError ? (
              '\u2014'
            ) : preparing || (!isFree && !checkoutSession) ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : isFree ? (
              'Free'
            ) : (
              `$${money(totalDollars)}`
            )}
          </span>
        </div>
      </Card>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => setPreview((v) => !v)}
      >
        <EyeIcon className="size-4" />
        {preview ? 'Hide preview' : 'Preview message'}
      </Button>

      {preview && (
        <div className="flex justify-center">
          <div
            className={cn(
              'w-full max-w-[280px] rounded-2xl rounded-bl-sm bg-primary p-3 text-sm text-primary-foreground',
            )}
          >
            {imagePreviewUrl && (
              /* eslint-disable-next-line @next/next/no-img-element -- local
                 object URL preview of an unuploaded file */
              <img
                src={imagePreviewUrl}
                alt="Attached"
                className="mb-2 max-h-48 w-full rounded-xl object-cover"
              />
            )}
            <p className="whitespace-pre-wrap">
              {isServe ? withSampleFirstName(composedMessage) : composedMessage}
            </p>
          </div>
        </div>
      )}

      {preview && isServe && (
        <p className="-mt-3 text-center text-xs text-muted-foreground">
          {SMS_GREETING_PREVIEW.caption}
        </p>
      )}

      {readOnlySummary ? null : buildFailed ? (
        <Card className="items-start gap-3 border-destructive p-4">
          <p className="text-sm text-foreground">
            We couldn&apos;t prepare this audience. Try again.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={onRetryBuild}
            disabled={retryingBuild}
            loading={retryingBuild}
          >
            Try again
          </Button>
        </Card>
      ) : prepareError ? (
        <Card className="items-start gap-3 border-destructive p-4">
          <p className="text-sm text-foreground">
            We couldn&apos;t set up your purchase. Go back a step and try again.
          </p>
        </Card>
      ) : preparing ||
        !outreachId ||
        // The paid card and its "$X due today" note render only once the
        // session amount is known — mounting earlier flashed "$0.00 due
        // today" while Stripe loaded.
        (!isFree && !checkoutSession && !error) ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : payError || sessionError ? (
        <PurchaseError serverError={payErrorMessage ?? undefined} />
      ) : isFree ? (
        <Button
          type="button"
          size="large"
          className="w-full"
          onClick={handleFreeComplete}
          disabled={isRedeeming}
          loading={isRedeeming}
        >
          Schedule campaign
        </Button>
      ) : (
        <>
          <Card className="gap-3 p-4">
            <p className="font-medium text-foreground">Payment details</p>
            <CheckoutPayment
              onPaymentSuccess={handlePaidComplete}
              onPaymentError={setCardError}
              onTotalChange={setLiveTotalDollars}
            />
          </Card>
          {inlineCardError && (
            <Alert
              variant="destructive"
              icon={<CircleAlertIcon className="size-4" />}
            >
              <AlertTitle>Your payment didn&apos;t go through</AlertTitle>
              <AlertDescription>{inlineCardError}</AlertDescription>
            </Alert>
          )}
          <Alert variant="info" icon={<InfoIcon className="size-4" />}>
            <AlertTitle>
              {priceIsCeiling
                ? `Up to $${money(totalDollars)}`
                : `$${money(totalDollars)} due today`}
            </AlertTitle>
            <AlertDescription>
              {priceIsCeiling
                ? 'Charged for your reachable list, up to this amount. Your Pro subscription is billed separately.'
                : 'One-time charge for this campaign. Your Pro subscription is billed separately.'}
            </AlertDescription>
          </Alert>
        </>
      )}
    </div>
  )
}
