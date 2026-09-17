import { useCheckoutSession } from 'app/dashboard/purchase/components/CheckoutSessionProvider'
import {
  PURCHASE_STATE,
  PurchaseType,
  PurchaseState,
} from 'helpers/purchaseTypes'
import { Spinner } from '@styleguide'
import PurchaseError from 'app/dashboard/purchase/components/PurchaseError'
import PurchaseSuccess from 'app/dashboard/purchase/components/PurchaseSuccess'

interface PaymentInterstitialsProps {
  type: PurchaseType
  purchaseState: PurchaseState
  returnUrl?: string
}

export const PaymentInterstitials = ({
  type,
  purchaseState,
  returnUrl,
}: PaymentInterstitialsProps): React.JSX.Element | null => {
  const { error, isLoading } = useCheckoutSession()
  const inErrorState = purchaseState === PURCHASE_STATE.ERROR || error
  return isLoading ? (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80">
      <Spinner />
    </div>
  ) : inErrorState ? (
    <PurchaseError error={error || undefined} />
  ) : purchaseState === PURCHASE_STATE.SUCCESS ? (
    <PurchaseSuccess type={type} returnUrl={returnUrl} />
  ) : null
}
