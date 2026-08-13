import { useRef, useState } from 'react'
import H1 from '@shared/typography/H1'
import CheckoutPayment from 'app/dashboard/purchase/components/CheckoutPayment'
import { Button } from '@styleguide'
import { useCampaign } from '@shared/hooks/useCampaign'
import { FREE_TEXTS_OFFER } from '../../../outreach/constants'
import { useP2pUxEnabled } from 'app/dashboard/components/tasks/flows/hooks/P2pUxEnabledProvider'
import { useCheckoutSession } from 'app/dashboard/purchase/components/CheckoutSessionProvider'
import {
  completeCheckoutSession,
  completeFreePurchase,
} from 'app/dashboard/purchase/utils/purchaseFetch.utils'
import { PURCHASE_TYPES } from 'helpers/purchaseTypes'
import { noop } from '@shared/utils/noop'

interface OutreachPurchaseFormProps {
  onComplete?: () => void | Promise<void>
  contactCount?: number
  pricePerContact?: number
  onError?: () => void
  outreachId?: number
  phoneListToken?: string
  // ENG-10808: from the phone-list status poll's capture-row fields — shown
  // here so a user can see why contactCount is smaller than their saved
  // list's raw membership.
  excludedOptedOutCount?: number | null
  excludedDuplicatePhoneCount?: number | null
}

export const OutreachPurchaseForm = ({
  onComplete = noop,
  contactCount = 0,
  pricePerContact = 0,
  onError = noop,
  outreachId,
  phoneListToken,
  excludedOptedOutCount,
  excludedDuplicatePhoneCount,
}: OutreachPurchaseFormProps) => {
  const [campaign] = useCampaign()
  const { p2pUxEnabled } = useP2pUxEnabled()
  const { checkoutSession } = useCheckoutSession()
  const [isRedeeming, setIsRedeeming] = useState(false)
  const isRedeemingRef = useRef(false)

  const hasFreeTextsOffer = p2pUxEnabled && campaign?.hasFreeTextsOffer
  const discount = hasFreeTextsOffer
    ? Math.min(contactCount, FREE_TEXTS_OFFER.COUNT)
    : 0
  const isFree =
    checkoutSession?.amount === 0 ||
    (hasFreeTextsOffer && contactCount <= FREE_TEXTS_OFFER.COUNT)
  const totalCost = isFree ? 0 : (checkoutSession?.amount ?? 0)

  const handleFreeComplete = async () => {
    if (isRedeemingRef.current) return
    isRedeemingRef.current = true
    setIsRedeeming(true)
    try {
      const response = await completeFreePurchase(PURCHASE_TYPES.TEXT, {
        contactCount,
        pricePerContact,
        outreachType: 'p2p',
        outreachId,
        phoneListToken,
      })
      if (!response.ok) {
        onError()
        return
      }
      await onComplete()
    } catch {
      onError()
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
    <div className="min-h-max">
      <H1>Review</H1>

      <div className="bg-gray-50 border rounded-lg p-4 mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-gray-700">Number of texts</span>
          <span className="font-medium">{contactCount.toLocaleString()}</span>
        </div>

        {/* ENG-10808: only worth a line when the build actually excluded
        someone — a 0 count here would just be noise under "Number of
        texts". */}
        {!!excludedOptedOutCount && (
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-700">Excluded (opted out)</span>
            <span className="font-medium">
              {excludedOptedOutCount.toLocaleString()}
            </span>
          </div>
        )}

        {!!excludedDuplicatePhoneCount && (
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-700">Duplicate numbers removed</span>
            <span className="font-medium">
              {excludedDuplicatePhoneCount.toLocaleString()}
            </span>
          </div>
        )}

        {hasFreeTextsOffer && (
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-700">Discount</span>
            <span className="font-medium text-green-600">
              Up to {discount.toLocaleString()} Free
            </span>
          </div>
        )}

        <div className="border-t pt-2 mt-2">
          <div className="flex justify-between items-center">
            <span className="font-semibold">Total</span>
            <span className="font-semibold text-lg">
              ${totalCost.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {isFree ? (
        <Button
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
          onPaymentError={onError}
        />
      )}
    </div>
  )
}
