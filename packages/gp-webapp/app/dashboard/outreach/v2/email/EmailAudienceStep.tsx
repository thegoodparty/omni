import { useRef, useState } from 'react'
import type { EmailRecipientUploadResponse } from '@goodparty_org/contracts'
import { Alert, AlertDescription, Button, Checkbox, Label } from '@styleguide'
import { CircleAlertIcon } from '@styleguide/components/ui/icons'
import { Intro } from '../social/Intro'
import {
  apiErrorMessage,
  uploadEmailRecipients,
  useEmailSender,
} from './emailApi'
import { formatCount, uploadSummary, warmingCap } from './emailFlow.util'
import type { EmailSurface } from './emailSurface'

interface EmailAudienceStepProps {
  surface: EmailSurface
  draftId: number
  result: EmailRecipientUploadResponse | null
  onUploaded: (result: EmailRecipientUploadResponse) => void
}

export const EmailAudienceStep = ({
  surface,
  draftId,
  result,
  onUploaded,
}: EmailAudienceStepProps) => {
  const { data: sender } = useEmailSender()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [consent, setConsent] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cap = sender ? warmingCap(sender.warmingStep) : null
  const capped = result !== null && cap !== null && result.ready > cap

  const upload = async () => {
    if (!file || !consent) return
    setUploading(true)
    setError(null)
    try {
      onUploaded(await uploadEmailRecipients(draftId, file))
    } catch (e) {
      setError(apiErrorMessage(e))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-6">
      <Intro title={surface.audience.title} body={surface.audience.caption} />

      <div className="space-y-2">
        <Label htmlFor="email-list-file">Your list (CSV)</Label>
        <input
          ref={inputRef}
          id="email-list-file"
          type="file"
          accept=".csv,text/csv"
          className="block w-full text-sm"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <div className="flex items-start gap-3">
        <Checkbox
          id="email-consent"
          checked={consent}
          onCheckedChange={(value) => setConsent(value === true)}
          className="mt-0.5"
        />
        <Label htmlFor="email-consent" className="block text-sm font-normal">
          {surface.audience.consentLabel}
        </Label>
      </div>

      <Button
        type="button"
        variant="outline"
        disabled={!file || !consent}
        loading={uploading}
        onClick={() => {
          void upload()
        }}
      >
        {result ? 'Replace my list' : 'Check my list'}
      </Button>

      {error && (
        <Alert variant="destructive" icon={<CircleAlertIcon />}>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <div
          className="space-y-2"
          role="status"
          data-testid="email-upload-summary"
        >
          <p className="text-base font-medium text-foreground">
            {uploadSummary(result)}
          </p>
          {capped && cap !== null && (
            <>
              <p className="text-sm text-muted-foreground">
                This send can reach up to {formatCount(cap)}{' '}
                {surface.recipientsNoun}. You can reach more on your next send.
              </p>
              <p className="text-sm text-muted-foreground">
                {formatCount(cap)} of {formatCount(result.ready)}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
