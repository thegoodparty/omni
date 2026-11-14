'use client'

import { Button, PhoneMessagePreview } from '@styleguide'
import { getImageAspectWarning } from '@goodparty_org/contracts'

export type SmsPreviewMode = 'create' | 'edit'

interface SmsPreviewStepProps {
  mode: SmsPreviewMode
  script: string
  imageUrl: string | null
  onEdit: () => void
}

export const SmsPreviewStep = ({
  mode,
  script,
  imageUrl,
  onEdit,
}: SmsPreviewStepProps) => (
  <div className="flex flex-col gap-4" data-mode={mode}>
    <p className="text-sm text-muted-foreground">
      This is how your text shows up on a voter&apos;s phone.
    </p>
    <PhoneMessagePreview
      imageUrl={imageUrl}
      script={script}
      getAspectWarning={getImageAspectWarning}
    />
    <Button variant="outline" onClick={onEdit} className="self-start">
      Edit
    </Button>
  </div>
)
