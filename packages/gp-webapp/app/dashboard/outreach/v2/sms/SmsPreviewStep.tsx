import { PhoneMessagePreview } from '@styleguide'
import { getImageAspectWarning } from '@goodparty_org/contracts'
import { Intro } from '../social/Intro'

export type SmsPreviewMode = 'create' | 'edit'

interface SmsPreviewStepProps {
  mode: SmsPreviewMode
  script: string
  imageUrl: string | null
  senderName?: string
}

export const SmsPreviewStep = ({
  mode,
  script,
  imageUrl,
  senderName,
}: SmsPreviewStepProps) => (
  <div className="flex flex-col gap-4" data-mode={mode}>
    <Intro
      title="Does this look right?"
      body="This is how it shows up on a phone."
    />
    <PhoneMessagePreview
      imageUrl={imageUrl}
      script={script}
      senderName={senderName}
      getAspectWarning={getImageAspectWarning}
    />
    <p className="text-sm text-muted-foreground">
      Each person sees their own first name.
    </p>
  </div>
)
