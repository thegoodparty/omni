'use client'

import { useState } from 'react'
import { useClerk } from '@clerk/nextjs'
import { clientRequest } from 'gpApi/typed-request'
import { stopImpersonatingAndReturnToAdmin } from '@shared/user/stopImpersonating'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from '@styleguide'

type Props = {
  meetingDate: string
  reviewsCount: number
}

type PendingVerdict = 'passed' | 'failed' | null

export default function ReviewVerdictControls({
  meetingDate,
  reviewsCount,
}: Props): React.JSX.Element {
  const { signOut } = useClerk()
  const [pending, setPending] = useState<PendingVerdict>(null)
  const [failReason, setFailReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const failNeedsReason = reviewsCount === 0 && failReason.trim() === ''

  const close = () => {
    setPending(null)
    setFailReason('')
    setError(null)
  }

  const submit = async () => {
    if (!pending) return
    setSubmitting(true)
    setError(null)
    const reason = failReason.trim()
    let ok = false
    try {
      const res = await clientRequest(
        'PUT /v1/meetings/:date/briefing/review-verdict',
        {
          date: meetingDate,
          verdict: pending,
          ...(pending === 'failed' && reason ? { failReason: reason } : {}),
        },
        { ignoreResponseError: true },
      )
      ok = res.ok
    } catch {
      ok = false
    }
    if (!ok) {
      setSubmitting(false)
      setError('Could not save the verdict. Please try again.')
      return
    }
    await stopImpersonatingAndReturnToAdmin(signOut)
  }

  const failing = pending === 'failed'
  const failDescription =
    reviewsCount > 0
      ? 'Your review comments are attached. Optionally add an overall reason. The verdict is recorded and your review session ends.'
      : 'There are no review comments on this briefing, so a reason is required.'

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setPending('failed')}
        className="text-sm!"
      >
        Fail
      </Button>
      <Button onClick={() => setPending('passed')} className="text-sm!">
        Pass
      </Button>

      <Dialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) close()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {failing ? 'Fail this briefing?' : 'Pass this briefing?'}
            </DialogTitle>
            <DialogDescription>
              {failing
                ? failDescription
                : 'The verdict is recorded and your review session ends.'}
            </DialogDescription>
          </DialogHeader>

          {failing && (
            <Textarea
              placeholder="Why is this briefing failing?"
              maxLength={2000}
              value={failReason}
              onChange={(e) => setFailReason(e.target.value)}
            />
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" disabled={submitting} onClick={close}>
              Cancel
            </Button>
            <Button
              variant={failing ? 'destructive' : 'default'}
              disabled={submitting || (failing && failNeedsReason)}
              onClick={submit}
            >
              {failing ? 'Confirm fail' : 'Confirm pass'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
