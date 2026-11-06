import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { EmailDeliveryCounts, EmailSend } from '@goodparty_org/contracts'
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Spinner,
} from '@styleguide'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleSlashIcon,
} from '@styleguide/components/ui/icons'
import { PaymentHoldCard } from 'app/dashboard/shared/payment-hold/PaymentHoldCard'
import { Intro } from '../social/Intro'
import {
  apiErrorMessage,
  CARD_ON_FILE,
  cancelEmail,
  confirmEmail,
  emailSendQueryKey,
  useEmailSend,
} from './emailApi'
import { EmailPreview } from './EmailPreview'
import { EmailSummary } from './EmailSummary'
import { formatCount } from './emailFlow.util'
import type { EmailSurface } from './emailSurface'

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

// pending_payment is a placement that came back declined while the user
// waited; a scheduled send's hold can also be declined later, off-session.
const needsCard = (send: EmailSend): boolean =>
  send.status === 'pending_payment' ||
  (send.status === 'pending' && send.cardDeclined)

interface StatusCopy {
  title: string
  caption: string
}

export const emailStatusCopy = (
  send: EmailSend,
  surface: EmailSurface,
): StatusCopy | null => {
  const total = send.recipientCap ?? send.recipientCount
  if (needsCard(send)) {
    return {
      title: 'We need a card.',
      caption: 'Your email will not go out until your card is on file.',
    }
  }
  switch (send.status) {
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
    case 'completed': {
      // Prepare trims the list to the cap, so once a send has run its
      // recipients are everyone it meant to reach. Fewer sent means it was
      // stopped at the payment deadline, or SES refused a few addresses, so
      // the caption gives the count and no reason.
      const reach = Math.min(send.recipientCount, total)
      return {
        title: 'Sent.',
        caption:
          send.sentCount < reach
            ? `Sent to ${formatCount(send.sentCount)} of ${formatCount(reach)} ${surface.recipientsNoun}.`
            : `${formatCount(send.sentCount)} emails went out.`,
      }
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
        caption:
          send.sentCount > 0
            ? `${formatCount(send.sentCount)} went out before it stopped.`
            : 'Your card was not charged.',
      }
    case 'draft':
      return {
        title: 'This email is still a draft.',
        caption: 'Pick up where you left off.',
      }
    default:
      return null
  }
}

const CANCELABLE = ['pending_payment', 'pending', 'in_progress']

export const EMAIL_RESULT_ROWS: {
  label: string
  count: (counts: EmailDeliveryCounts) => number
}[] = [
  { label: 'Delivered', count: (c) => c.delivered },
  { label: 'Opened (approximate)', count: (c) => c.opened },
  { label: 'Clicked', count: (c) => c.clicked },
  { label: 'Bounced', count: (c) => c.bounced },
  { label: 'Marked as spam', count: (c) => c.complained },
]

// Laid out like a text send's Statistics card: each count with its share
// of the emails that went out.
const EmailResults = ({ counts }: { counts: EmailDeliveryCounts }) => (
  <div data-testid="email-results">
    <dt className="text-muted-foreground">Results</dt>
    <dd className="mt-1 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between px-3 py-2">
        <span>Sent</span>
        <span className="font-semibold">{formatCount(counts.sent)}</span>
      </div>
      {EMAIL_RESULT_ROWS.map((row) => {
        const count = row.count(counts)
        return (
          <div
            key={row.label}
            className="flex items-center justify-between border-t border-border px-3 py-2"
          >
            <span>{row.label}</span>
            <span className="flex items-baseline gap-2">
              <span className="font-semibold">{formatCount(count)}</span>
              <span className="text-xs text-muted-foreground">
                {Math.round((count / counts.sent) * 100)}%
              </span>
            </span>
          </div>
        )
      })}
    </dd>
  </div>
)

interface EmailStatusProps {
  surface: EmailSurface
  id: number
  // Confirm stamps a send-now with the time it goes out, so right after
  // paying the flow passes the When it showed on Review.
  sendLabel?: string
  // Right after paying: a paid send opens with the success mark the other
  // channels show, not the plain status line.
  justPaid?: boolean
  // Paid with no later date: a pending send is about to go out, so it reads
  // as sending rather than scheduled.
  sendNow?: boolean
}

const SUCCESS_TITLES: Partial<Record<EmailSend['status'], string>> = {
  pending: 'Your email is scheduled',
  in_progress: 'Your email is sending',
  completed: 'Your email was sent',
}

export const EmailStatus = ({
  surface,
  id,
  sendLabel,
  justPaid = false,
  sendNow = false,
}: EmailStatusProps) => {
  const queryClient = useQueryClient()
  const { data: send, isError } = useEmailSend(surface.isServe, id)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (isError) {
    return (
      <Intro
        title="We couldn't find this email."
        body="Go back to your outreach and try again."
      />
    )
  }
  if (!send) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    )
  }
  const copy = emailStatusCopy(send, surface) ?? {
    title: 'Something is off with this email.',
    caption: 'Go back to your outreach and try again.',
  }

  const successTitle =
    sendNow && send.status === 'pending'
      ? SUCCESS_TITLES.in_progress
      : SUCCESS_TITLES[send.status]

  const reachCount = send.recipientCap ?? send.estimate?.recipientCap
  const reach =
    reachCount === undefined
      ? null
      : {
          count: reachCount,
          outOf: send.estimate?.audienceCount ?? reachCount,
        }

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

  // Either way the send's hold exists, so the card goes to the hold's route.
  // A pending_payment send then waits on a confirm; a scheduled one stays
  // scheduled and only needs its hold state read again.
  const cardUpdated = async () => {
    setError(null)
    try {
      if (send.status === 'pending_payment') {
        refresh((await confirmEmail(surface.isServe, id, CARD_ON_FILE)).email)
      } else {
        await queryClient.invalidateQueries({
          queryKey: emailSendQueryKey(surface.isServe, id),
        })
      }
    } catch (e) {
      setError(apiErrorMessage(e))
    }
  }

  return (
    <div className="space-y-6" data-testid="email-status">
      {justPaid && !needsCard(send) && successTitle ? (
        <div className="space-y-4 py-4 text-center" data-testid="email-success">
          <div className="flex justify-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-primary-light">
              <CircleCheckIcon className="size-8 text-primary" />
            </span>
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold text-foreground">
              {successTitle}
            </h2>
            <p className="text-muted-foreground">{copy.caption}</p>
          </div>
        </div>
      ) : (
        <Intro title={copy.title} body={copy.caption} />
      )}
      {needsCard(send) && (
        <div className="space-y-3" data-testid="email-update-card">
          <h4 className="text-base font-semibold text-foreground">
            Update your card
          </h4>
          <PaymentHoldCard
            mode={surface.isServe ? 'serve' : 'win'}
            outreachId={id}
            submitLabel="Pay and send"
            onOutcome={() => void cardUpdated()}
          />
        </div>
      )}
      <EmailSummary
        surface={surface}
        subtitle={send.content.subject}
        reach={reach}
        priceCents={send.priceCents ?? send.estimate?.priceCents ?? null}
        when={
          sendLabel ??
          (send.date ? whenLabel(send.date) : "As soon as it's paid")
        }
      >
        {send.deliveryCounts && send.deliveryCounts.sent > 0 && (
          <EmailResults counts={send.deliveryCounts} />
        )}
      </EmailSummary>
      {error && (
        <Alert variant="destructive" icon={<CircleAlertIcon />}>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {CANCELABLE.includes(send.status) && !send.stopping && (
        <Button
          type="button"
          variant="outline"
          className="border-destructive text-destructive hover:bg-destructive/10"
          onClick={() => setConfirmingCancel(true)}
        >
          <CircleSlashIcon className="size-4" />
          Cancel this email
        </Button>
      )}
      <EmailPreview
        serve={surface.isServe}
        content={send.content}
        subject={send.subject}
      />
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
              variant="destructive"
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
