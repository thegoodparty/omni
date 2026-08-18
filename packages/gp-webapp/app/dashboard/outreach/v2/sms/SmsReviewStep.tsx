'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Card,
  cn,
} from '@styleguide'
import {
  EyeIcon,
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
import { LoadingAnimation } from '@shared/utils/LoadingAnimation'
import { FREE_TEXTS_OFFER } from 'app/dashboard/outreach/constants'
import { PURCHASE_TYPES } from 'helpers/purchaseTypes'
import { Intro } from '../social/Intro'

const money = (cents: number): string => (cents / 100).toFixed(2)

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

interface SmsReviewStepProps {
  audienceName: string
  sendAt: Date
  composedMessage: string
  imagePreviewUrl: string | null
  contactCount: number
  pricePerContact: number
  outreachId: number | null
  phoneListToken: string | null
  excludedOptedOutCount: number | null
  excludedDuplicatePhoneCount: number | null
  // Draft creation happens in the flow; until it lands there is no session
  // to fetch, so the pay card shows a preparing state.
  preparing: boolean
  prepareError: boolean
  onComplete: () => Promise<void>
}

export const SmsReviewStep = ({
  audienceName,
  sendAt,
  composedMessage,
  imagePreviewUrl,
  contactCount,
  pricePerContact,
  outreachId,
  phoneListToken,
  excludedOptedOutCount,
  excludedDuplicatePhoneCount,
  preparing,
  prepareError,
  onComplete,
}: SmsReviewStepProps) => {
  const [campaign] = useCampaign()
  const { checkoutSession, error, fetchClientSecret } = useCheckoutSession()
  const [preview, setPreview] = useState(false)
  const [isRedeeming, setIsRedeeming] = useState(false)
  const [payError, setPayError] = useState(false)
  const isRedeemingRef = useRef(false)
  const hasFetchedSession = useRef(false)

  const hasFreeTextsOffer = Boolean(campaign?.hasFreeTextsOffer)
  const discount = hasFreeTextsOffer
    ? Math.min(contactCount, FREE_TEXTS_OFFER.COUNT)
    : 0
  const isFree =
    checkoutSession?.amount === 0 ||
    (hasFreeTextsOffer && contactCount <= FREE_TEXTS_OFFER.COUNT)
  const totalCents = isFree ? 0 : (checkoutSession?.amount ?? 0)

  useEffect(() => {
    if (!outreachId || hasFetchedSession.current) return
    hasFetchedSession.current = true
    fetchClientSecret().catch(() => {
      // Surfaced through the provider's error state below.
    })
  }, [outreachId, fetchClientSecret])

  const handleFreeComplete = async () => {
    if (isRedeemingRef.current) return
    isRedeemingRef.current = true
    setIsRedeeming(true)
    try {
      const response = await completeFreePurchase(PURCHASE_TYPES.TEXT, {
        contactCount,
        pricePerContact,
        outreachType: 'p2p',
        outreachId: outreachId ?? undefined,
        phoneListToken: phoneListToken ?? undefined,
      })
      if (!response.ok) {
        setPayError(true)
        return
      }
      await onComplete()
    } catch {
      setPayError(true)
    } finally {
      isRedeemingRef.current = false
      setIsRedeeming(false)
    }
  }

  const handlePaidComplete = async (sessionId: string) => {
    const response = await completeCheckoutSession(sessionId)
    if (!response.ok) {
      throw new Error('Failed to complete purchase')
    }
    await onComplete()
  }

  return (
    <div className="space-y-6">
      <Intro
        channel="text"
        title="Review & pay"
        body="Review your campaign details and complete your payment."
      />

      <Card className="gap-0 overflow-hidden p-0">
        <Accordion type="single" collapsible defaultValue="details">
          <AccordionItem value="details" className="border-none">
            <AccordionTrigger className="px-4 py-4 hover:no-underline">
              <div className="flex items-center gap-3 text-left">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-info-light">
                  <MessageSquareIcon className="size-6 text-foreground" />
                </span>
                <div>
                  <p className="font-medium text-foreground">Text message</p>
                  <p className="text-sm font-normal text-foreground">
                    Send date: {fmtDate(sendAt)}
                  </p>
                  <p className="text-sm font-normal text-foreground">
                    Send time:{' '}
                    {sendAt.toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-foreground">Recipients</dt>
                  <dd className="text-foreground">
                    {contactCount.toLocaleString()}
                  </dd>
                </div>
                {!!excludedOptedOutCount && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">
                      Excluded (opted out)
                    </dt>
                    <dd className="text-muted-foreground">
                      {excludedOptedOutCount.toLocaleString()}
                    </dd>
                  </div>
                )}
                {!!excludedDuplicatePhoneCount && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">
                      Duplicate numbers removed
                    </dt>
                    <dd className="text-muted-foreground">
                      {excludedDuplicatePhoneCount.toLocaleString()}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-foreground">Price per message</dt>
                  <dd className="text-foreground">
                    ${pricePerContact.toFixed(3)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-foreground">Audience</dt>
                  <dd className="text-foreground">{audienceName}</dd>
                </div>
                {hasFreeTextsOffer && (
                  <div className="flex justify-between">
                    <dt className="text-foreground">Free texts discount</dt>
                    <dd className="text-success">
                      Up to {discount.toLocaleString()} free
                    </dd>
                  </div>
                )}
              </dl>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        <div className="flex items-center justify-between border-t border-border px-4 py-4">
          <span className="font-medium text-foreground">Total</span>
          <span className="font-semibold text-foreground">
            {preparing || (!isFree && !checkoutSession) ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              `$${money(totalCents)}`
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
            <p className="whitespace-pre-wrap">{composedMessage}</p>
          </div>
        </div>
      )}

      {prepareError ? (
        <Card className="items-start gap-3 border-destructive p-4">
          <p className="text-sm text-foreground">
            We couldn&apos;t set up your purchase. Go back a step and try again.
          </p>
        </Card>
      ) : preparing || !outreachId ? (
        <div className="py-6">
          <LoadingAnimation title="Preparing your purchase…" />
        </div>
      ) : payError || error ? (
        <PurchaseError />
      ) : isFree ? (
        <Button
          type="button"
          size="large"
          className="w-full"
          onClick={handleFreeComplete}
          disabled={isRedeeming}
          loading={isRedeeming}
        >
          Schedule text
        </Button>
      ) : (
        <CheckoutPayment
          onPaymentSuccess={handlePaidComplete}
          onPaymentError={() => setPayError(true)}
        />
      )}
    </div>
  )
}
