import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type {
  EmailSend,
  PaymentHoldCardResponse,
} from '@goodparty_org/contracts'
import { PaymentHoldCard } from 'app/dashboard/shared/payment-hold/PaymentHoldCard'
import { Button } from '@styleguide'
import { Intro } from '../social/Intro'
import {
  apiErrorMessage,
  CARD_ON_FILE,
  confirmEmail,
  emailSendQueryKey,
  useEmailSend,
} from './emailApi'
import { formatDollars } from './emailFlow.util'
import type { EmailSurface } from './emailSurface'

interface EmailPayStepProps {
  surface: EmailSurface
  draftId: number
  onPaid: (send: EmailSend) => void
  // Fired once confirm has been tried, so the flow can stop offering Back:
  // a later confirm would ignore a different card.
  onConfirmAttempted: () => void
}

export const EmailPayStep = ({
  surface,
  draftId,
  onPaid,
  onConfirmAttempted,
}: EmailPayStepProps) => {
  const queryClient = useQueryClient()
  const { data: send } = useEmailSend(surface.isServe, draftId)
  const confirmedRef = useRef<EmailSend | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const savePaymentMethod = async (
    paymentMethodId: string,
  ): Promise<PaymentHoldCardResponse> => {
    const result = await confirmEmail(surface.isServe, draftId, paymentMethodId)
    onConfirmAttempted()
    if (result.outcome === 'declined') {
      return { outcome: 'declined', declineCode: result.declineCode }
    }
    confirmedRef.current = result.email
    // The send is confirmed either way; captureBefore only matters to
    // callers that show the hold's deadline, and the email flow does not.
    return result.outcome === 'held'
      ? { outcome: 'held', captureBefore: '' }
      : { outcome: 'scheduled' }
  }

  const finish = async () => {
    setFinishing(true)
    setError(null)
    try {
      const confirmed =
        confirmedRef.current ??
        (await confirmEmail(surface.isServe, draftId, CARD_ON_FILE)).email
      queryClient.setQueryData(
        emailSendQueryKey(surface.isServe, draftId),
        confirmed,
      )
      onPaid(confirmed)
    } catch (e) {
      setError(apiErrorMessage(e))
    } finally {
      setFinishing(false)
    }
  }

  return (
    <div className="space-y-6">
      <Intro
        title="How do you want to pay?"
        body="Your card is held now. You are charged only for emails that go out."
      />
      {send?.estimate && (
        <p className="text-sm text-foreground" data-testid="email-pay-price">
          Up to {formatDollars(send.estimate.priceCents)}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {accepted ? (
        <Button
          type="button"
          size="large"
          className="w-full"
          loading={finishing}
          onClick={() => void finish()}
        >
          {error ? 'Try again' : 'Finishing up'}
        </Button>
      ) : (
        <PaymentHoldCard
          mode={surface.isServe ? 'serve' : 'win'}
          outreachId={draftId}
          submitLabel="Pay and send"
          savePaymentMethod={savePaymentMethod}
          onOutcome={() => {
            setAccepted(true)
            void finish()
          }}
        />
      )}
    </div>
  )
}
