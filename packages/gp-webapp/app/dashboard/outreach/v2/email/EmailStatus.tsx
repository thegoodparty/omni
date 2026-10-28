import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { EmailSend } from '@goodparty_org/contracts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from '@styleguide'
import { PaymentHoldCard } from 'app/dashboard/shared/payment-hold/PaymentHoldCard'
import { Intro } from '../social/Intro'
import {
  apiErrorMessage,
  cancelEmail,
  confirmEmail,
  emailSendQueryKey,
  useEmailSend,
} from './emailApi'
import { formatCount } from './emailFlow.util'
import type { EmailSurface } from './emailSurface'

const CARD_ON_FILE = 'card-on-file'

const SELF_CLEARING_PAUSES = ['ses_account', 'daily_quota']

const whenLabel = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })

interface StatusCopy {
  title: string
  caption: string
}

export const emailStatusCopy = (send: EmailSend): StatusCopy | null => {
  const total = send.recipientCap ?? send.recipientCount
  switch (send.status) {
    case 'pending_payment':
      return {
        title: 'We need a card.',
        caption: 'Your email will not go out until your card is on file.',
      }
    case 'pending':
      return {
        title: 'Scheduled.',
        caption: send.date
          ? `It goes out ${whenLabel(send.date)}.`
          : 'It goes out soon.',
      }
    case 'in_progress':
      if (send.stopping) {
        return {
          title: 'Stopping.',
          caption: `${formatCount(send.sentCount)} went out before it stopped.`,
        }
      }
      if (send.pauseReason) {
        return {
          title: 'Paused.',
          caption: SELF_CLEARING_PAUSES.includes(send.pauseReason)
            ? 'Sending picks up again on its own soon.'
            : 'We paused this send to check it. Nothing more goes out until we clear it.',
        }
      }
      return {
        title: `Sending ${formatCount(send.sentCount)} of ${formatCount(total)}.`,
        caption: 'This page updates as it goes.',
      }
    case 'completed':
      return {
        title: 'Sent.',
        caption: `${formatCount(send.sentCount)} emails went out.`,
      }
    case 'canceled':
      return {
        title: 'Canceled.',
        caption:
          send.sentCount > 0
            ? `${formatCount(send.sentCount)} went out before you canceled.`
            : 'Nothing went out.',
      }
    case 'failed':
      return {
        title: "It didn't go out.",
        caption: 'Your card was not charged.',
      }
    default:
      return null
  }
}

const CANCELABLE = ['pending_payment', 'pending', 'in_progress']

interface EmailStatusProps {
  surface: EmailSurface
  id: number
}

export const EmailStatus = ({ surface, id }: EmailStatusProps) => {
  const queryClient = useQueryClient()
  const { data: send, isError } = useEmailSend(surface.isServe, id)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirmedRef = useRef(false)

  if (isError) {
    return (
      <Intro
        title="We couldn't find this email."
        body="Go back to your outreach and try again."
      />
    )
  }
  if (!send) return null
  const copy = emailStatusCopy(send)
  if (!copy) return null

  const refresh = (next: EmailSend) =>
    queryClient.setQueryData(emailSendQueryKey(surface.isServe, id), next)

  const cancel = async () => {
    setCanceling(true)
    setError(null)
    try {
      refresh(await cancelEmail(surface.isServe, id))
    } catch (e) {
      setError(apiErrorMessage(e))
    } finally {
      setCanceling(false)
      setConfirmingCancel(false)
    }
  }

  // A card change on a declined send goes to the hold, which leaves the send
  // waiting on a confirm. Confirm ignores the card id once the hold exists.
  const cardUpdated = async () => {
    setError(null)
    if (confirmedRef.current) return
    try {
      refresh((await confirmEmail(surface.isServe, id, CARD_ON_FILE)).email)
    } catch (e) {
      setError(apiErrorMessage(e))
    }
  }

  return (
    <div className="space-y-6" data-testid="email-status">
      <Intro title={copy.title} body={copy.caption} />
      {send.status === 'pending_payment' && (
        <div className="space-y-3" data-testid="email-update-card">
          <h3 className="text-sm font-medium text-foreground">
            Update your card
          </h3>
          <PaymentHoldCard
            mode={surface.isServe ? 'serve' : 'win'}
            outreachId={id}
            submitLabel="Pay and send"
            savePaymentMethod={async (paymentMethodId) => {
              const result = await confirmEmail(
                surface.isServe,
                id,
                paymentMethodId,
              )
              if (result.outcome === 'declined') {
                return { outcome: 'declined', declineCode: result.declineCode }
              }
              confirmedRef.current = true
              refresh(result.email)
              return result.outcome === 'held'
                ? { outcome: 'held', captureBefore: '' }
                : { outcome: 'scheduled' }
            }}
            onOutcome={() => void cardUpdated()}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {CANCELABLE.includes(send.status) && !send.stopping && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setConfirmingCancel(true)}
        >
          Cancel this email
        </Button>
      )}
      <AlertDialog open={confirmingCancel} onOpenChange={setConfirmingCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this email?</AlertDialogTitle>
            <AlertDialogDescription>
              {send.status === 'in_progress'
                ? 'Emails already sent stay sent. The rest will not go out.'
                : 'Nothing will go out and your card will not be charged.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={canceling}
              onClick={(e) => {
                e.preventDefault()
                void cancel()
              }}
            >
              Cancel email
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
