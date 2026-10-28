import { useState } from 'react'
import type { EmailRecipientUploadResponse } from '@goodparty_org/contracts'
import { Button, Input, Label } from '@styleguide'
import { Intro } from '../social/Intro'
import { EmailComingSoon } from './EmailComingSoon'
import { EmailPreview } from './EmailPreview'
import {
  apiErrorMessage,
  sendEmailTest,
  useChangeForwardTo,
  useEmailSender,
} from './emailApi'
import {
  formatCount,
  nextWarmingCap,
  warmingCap,
  type EmailComposeState,
} from './emailFlow.util'
import type { EmailSurface } from './emailSurface'

interface EmailReviewStepProps {
  surface: EmailSurface
  compose: EmailComposeState
  result: EmailRecipientUploadResponse
  draftId: number | null
  sendLabel: string
}

export const EmailReviewStep = ({
  surface,
  compose,
  result,
  draftId,
  sendLabel,
}: EmailReviewStepProps) => {
  const { data: sender } = useEmailSender(surface.isServe)
  const changeForwardTo = useChangeForwardTo(surface.isServe)
  const [editing, setEditing] = useState(false)
  const [address, setAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  const sendTest = async () => {
    if (draftId === null) return
    setTesting(true)
    setTestError(null)
    setTestResult(null)
    try {
      const { sentTo } = await sendEmailTest(surface.isServe, draftId)
      setTestResult(`Test sent to ${sentTo}.`)
    } catch (e) {
      setTestError(apiErrorMessage(e))
    } finally {
      setTesting(false)
    }
  }

  const cap = sender ? warmingCap(sender.warmingStep) : null
  const capped = cap !== null && result.ready > cap

  const saveAddress = async () => {
    setSaving(true)
    setError(null)
    try {
      await changeForwardTo(address.trim())
      setEditing(false)
      setAddress('')
    } catch (e) {
      setError(apiErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Intro title={surface.review.title} body={surface.review.caption} />

      <EmailPreview
        layout={compose.layout}
        theme={compose.theme}
        senderName={sender?.displayName ?? ''}
        headline={compose.headline}
        body={compose.body}
        buttonLabel={compose.buttonLabel}
        buttonUrl={compose.buttonUrl}
        imageUrl={compose.imageUrl}
      />

      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Subject</dt>
          <dd className="font-medium text-foreground">{compose.subject}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Reaches</dt>
          <dd className="font-medium text-foreground">
            {capped && cap !== null
              ? `${formatCount(cap)} of ${formatCount(result.ready)}`
              : `${formatCount(result.ready)} ${surface.recipientsNoun}`}
          </dd>
          {capped && cap !== null && sender && (
            <dd className="text-muted-foreground">
              This send can reach up to {formatCount(cap)}{' '}
              {surface.recipientsNoun}.
              {nextWarmingCap(sender.warmingStep) !== null
                ? ' You can reach more on your next send.'
                : ''}
            </dd>
          )}
        </div>
        <div>
          <dt className="text-muted-foreground">When</dt>
          <dd className="font-medium text-foreground">{sendLabel}</dd>
        </div>
        {sender && (
          <div>
            <dt className="text-muted-foreground">Replies</dt>
            <dd className="font-medium text-foreground">
              Replies go to {sender.forwardToEmail}{' '}
              {!editing && (
                <Button
                  type="button"
                  variant="link"
                  size="small"
                  className="h-auto px-1"
                  onClick={() => setEditing(true)}
                >
                  Change
                </Button>
              )}
            </dd>
            {sender.pendingForwardToEmail && (
              <dd className="text-muted-foreground">
                Check {sender.pendingForwardToEmail} for a link to confirm the
                change.
              </dd>
            )}
          </div>
        )}
      </dl>

      {editing && (
        <div className="space-y-2">
          <Label htmlFor="email-forward-to">Send replies to</Label>
          <Input
            id="email-forward-to"
            type="email"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button
              type="button"
              size="small"
              disabled={!address.trim()}
              loading={saving}
              onClick={() => {
                void saveAddress()
              }}
            >
              Save address
            </Button>
            <Button
              type="button"
              size="small"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="space-y-2" data-testid="email-test-send">
          <Button
            type="button"
            size="small"
            variant="outline"
            loading={testing}
            disabled={draftId === null}
            onClick={() => {
              void sendTest()
            }}
          >
            Send me a test
          </Button>
          {testResult && (
            <p className="text-xs text-muted-foreground">{testResult}</p>
          )}
          {testError && <p className="text-xs text-destructive">{testError}</p>}
        </div>
        <EmailComingSoon feature="price" label="Price" />
        <EmailComingSoon feature="pay" label="Pay and send" />
      </div>
    </div>
  )
}
