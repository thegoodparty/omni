import { useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import {
  EmailConfirmDeclinedSchema,
  type EmailSend,
  type PaymentHoldCardResponse,
} from '@goodparty_org/contracts'
import { PaymentHoldCard } from 'app/dashboard/shared/payment-hold/PaymentHoldCard'
import { Intro } from '../social/Intro'
import {
  apiErrorMessage,
  confirmEmail,
  emailSendQueryKey,
  useEmailSend,
} from './emailApi'
import { parseBlockError } from './emailBlocks.util'
import { formatDollars } from './emailFlow.util'
import type { EmailSurface } from './emailSurface'

const PAYMENT_REQUIRED = 402
const BAD_REQUEST = 400

interface EmailPayStepProps {
  surface: EmailSurface
  draftId: number
  onPaid: (send: EmailSend) => void
  // Fired once a confirm may have moved the send past draft, so the flow
  // stops offering Back. A declined card leaves the send a draft.
  onConfirmAttempted: () => void
  // Confirm refused the content and named a block: nothing left draft, so
  // the flow goes back to that block.
  onFixBlock: (message: string) => void
}

export const EmailPayStep = ({
  surface,
  draftId,
  onPaid,
  onConfirmAttempted,
  onFixBlock,
}: EmailPayStepProps) => {
  const queryClient = useQueryClient()
  const { data: send } = useEmailSend(surface.isServe, draftId)
  const confirmedRef = useRef<EmailSend | null>(null)

  // Every card, the first and each one after a decline, goes through confirm.
  // A decline answers 402 and the send stays a draft, so the card form shows
  // it and the next card confirms again.
  const savePaymentMethod = async (
    paymentMethodId: string,
  ): Promise<PaymentHoldCardResponse> => {
    try {
      const result = await confirmEmail(
        surface.isServe,
        draftId,
        paymentMethodId,
      )
      onConfirmAttempted()
      confirmedRef.current = result.email
      // captureBefore only matters to callers that show the hold's deadline,
      // and the email flow does not.
      return result.outcome === 'held'
        ? { outcome: 'held', captureBefore: '' }
        : { outcome: 'scheduled' }
    } catch (e) {
      const declined =
        e instanceof FetchError && e.status === PAYMENT_REQUIRED
          ? EmailConfirmDeclinedSchema.safeParse(e.data)
          : null
      if (declined?.success) {
        return { outcome: 'declined', declineCode: declined.data.declineCode }
      }
      if (e instanceof FetchError && e.status === BAD_REQUEST) {
        const message = apiErrorMessage(e)
        if (parseBlockError(message)) {
          onFixBlock(message)
          throw e
        }
      }
      onConfirmAttempted()
      throw e
    }
  }

  const paid = () => {
    const confirmed = confirmedRef.current
    if (!confirmed) return
    queryClient.setQueryData(
      emailSendQueryKey(surface.isServe, draftId),
      confirmed,
    )
    onPaid(confirmed)
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
      <PaymentHoldCard
        mode={surface.isServe ? 'serve' : 'win'}
        outreachId={draftId}
        submitLabel="Pay and send"
        savePaymentMethod={savePaymentMethod}
        onOutcome={paid}
      />
    </div>
  )
}
