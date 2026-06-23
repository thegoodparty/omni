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

const SCORING_GUIDELINES_URL =
  'https://goodparty.clickup.com/90132012119/v/dc/2ky4jq2q-109293/2ky4jq2q-90393'

export const FAIL_REASON_TEMPLATE = [
  '- Voice & tone: pass/fail/na',
  '  - ↳ If fail, explain: ',
  '- Grounding & traceability: pass/fail/na',
  '  - ↳ If fail, explain: ',
  '- Coverage: pass/fail/na',
  '  - ↳ If fail, explain: ',
  '- Prioritization: pass/fail/na',
  '  - ↳ If fail, explain: ',
  '- Constituent data match: pass/fail/na',
  '  - ↳ If fail, explain: ',
].join('\n')

export default function ReviewVerdictControls({
  meetingDate,
  reviewsCount,
}: Props): React.JSX.Element {
  const { signOut } = useClerk()
  const [pending, setPending] = useState<PendingVerdict>(null)
  const [failReason, setFailReason] = useState(FAIL_REASON_TEMPLATE)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const failNeedsReason = reviewsCount === 0 && failReason.trim() === ''

  const close = () => {
    setPending(null)
    setFailReason(FAIL_REASON_TEMPLATE)
    setSubmitting(false)
    setError(null)
  }

  const submit = async () => {
    if (!pending) return
    setSubmitting(true)
    setError(null)
    const reason = failReason.trim()
    // When review comments exist the overall reason is optional, so an
    // untouched template means "no reason given" — omit it rather than
    // recording the blank rubric. With no comments a reason is required, so
    // the template is sent as-is.
    const untouchedTemplate = reason === FAIL_REASON_TEMPLATE.trim()
    const includeReason =
      pending === 'failed' &&
      !!reason &&
      !(reviewsCount > 0 && untouchedTemplate)
    let ok = false
    try {
      const res = await clientRequest(
        'PUT /v1/meetings/:date/briefing/review-verdict',
        {
          date: meetingDate,
          verdict: pending,
          ...(includeReason ? { failReason: reason } : {}),
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
    try {
      await stopImpersonatingAndReturnToAdmin(signOut)
    } catch {
      setSubmitting(false)
      setError('Could not end the session. Please refresh and try again.')
    }
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
          if (!next && !submitting) close()
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
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                Not sure how to grade this? See the{' '}
                <a
                  href={SCORING_GUIDELINES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  scoring guidelines
                </a>
                .
              </p>
              <Textarea
                aria-label="Fail reason"
                placeholder="Why is this briefing failing?"
                rows={11}
                maxLength={2000}
                value={failReason}
                onChange={(e) => setFailReason(e.target.value)}
              />
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

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
