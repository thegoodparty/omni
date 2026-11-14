'use client'

import { PhoneMessagePreview } from '@goodparty_org/styleguide'
import { getImageAspectWarning } from '@goodparty_org/contracts'

interface SmsMessagePreviewProps {
  imageUrl: string | null
  script: string | null
}

// The page is a server component and a function prop can't cross to the
// client styleguide component, so the warning is bound here.
export const SmsMessagePreview = ({
  imageUrl,
  script,
}: SmsMessagePreviewProps) => (
  <PhoneMessagePreview
    imageUrl={imageUrl}
    script={script}
    getAspectWarning={getImageAspectWarning}
  />
)
