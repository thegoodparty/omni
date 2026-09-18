'use client'

import { useEffect } from 'react'
import { Button } from '@styleguide'
import {
  ClockIcon,
  FileTextIcon,
  MailIcon,
} from '@styleguide/components/ui/icons'
import Body2 from '@shared/typography/Body2'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

const ROWS = [
  {
    icon: FileTextIcon,
    title: 'Your filing details',
    body: 'The committee name and filing link from your election authority',
  },
  {
    icon: MailIcon,
    title: 'Contact details',
    body: 'The email, phone or address exactly as it appears on your filing',
  },
  {
    icon: ClockIcon,
    title: 'About 1 to 2 weeks',
    body: 'A PIN arrives once the carriers clear your campaign',
  },
]

interface VerificationIntroProps {
  onContinue: () => void
  onBack: () => void
}

export const VerificationIntro = ({
  onContinue,
  onBack,
}: VerificationIntroProps): React.JSX.Element => {
  useEffect(() => {
    trackEvent(EVENTS.ProUpgrade.Verification.IntroViewed)
  }, [])

  return (
    <div>
      <h1 className="mb-1.5 text-[32px] leading-[44px] font-semibold">
        Campaign verification to send text messages
      </h1>
      <Body2 className="mb-6 text-base-muted-foreground">
        Carriers require a registered campaign before your first text can go
        out.
      </Body2>
      <ul className="rounded-xl border border-base-border">
        {ROWS.map(({ icon: Icon, title, body }) => (
          <li
            key={title}
            className="flex items-start gap-3 border-t border-base-border p-4 first:border-t-0"
          >
            <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="block font-semibold">{title}</span>
              <Body2 className="text-base-muted-foreground">{body}</Body2>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button
          variant="outline"
          size="large"
          className="w-full sm:w-auto"
          onClick={onBack}
        >
          Back
        </Button>
        <Button size="large" className="w-full sm:w-auto" onClick={onContinue}>
          Continue
        </Button>
      </div>
    </div>
  )
}
