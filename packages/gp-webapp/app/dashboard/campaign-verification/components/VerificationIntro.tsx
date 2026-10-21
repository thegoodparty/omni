'use client'

import { Button } from '@styleguide'
import { StepFooter } from 'app/dashboard/shared/StepFooter'
import { CalendarClockIcon } from '@styleguide/components/ui/icons'
import { useSmsCompliance } from 'app/dashboard/shared/smsCutoff/useSmsCompliance'
import {
  SMS_CUTOFF_COPY,
  VERIFICATION_INTRO_ROWS,
  formatSmsCutoffDate,
} from '../verificationCopy'

interface VerificationIntroProps {
  onContinue: () => void
  onBack: () => void
}

// Design: verifyintro — the intro title and caption, the three-row card of
// what the candidate needs, and a footer of Back beside Continue pinned to
// the bottom of the host's column.
export const VerificationIntro = ({
  onContinue,
  onBack,
}: VerificationIntroProps): React.JSX.Element => {
  const { smsCompliance, smsCutoffDate } = useSmsCompliance()
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-xl font-semibold">
          Verify your campaign to text voters
        </h1>
        <p className="text-base text-base-muted-foreground">
          Phone carriers require a registered campaign before your first text
          can go out.
        </p>
      </div>
      {smsCompliance === 'closing' && smsCutoffDate && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-warning-light px-4 py-2.5 text-sm text-warning-dark">
          <CalendarClockIcon className="size-4 shrink-0" aria-hidden />
          {SMS_CUTOFF_COPY.countdownDeadline(
            formatSmsCutoffDate(smsCutoffDate),
          )}
        </div>
      )}
      <ul className="overflow-hidden rounded-xl border border-base-border bg-card">
        {VERIFICATION_INTRO_ROWS.map(({ icon: Icon, title, body }) => (
          <li
            key={title}
            className="flex min-h-16 items-start gap-3 border-t border-base-border px-4 py-3.5 first:border-t-0"
          >
            <Icon
              className="mt-0.5 size-[18px] shrink-0 text-primary"
              aria-hidden
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{title}</span>
              <span className="mt-0.5 block text-[13px] text-base-muted-foreground">
                {body}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <StepFooter>
        <Button
          variant="ghost"
          size="large"
          className="w-full sm:w-auto"
          onClick={onBack}
        >
          Back
        </Button>
        <Button
          size="large"
          className="w-full sm:w-auto sm:min-w-[360px]"
          onClick={onContinue}
        >
          Continue
        </Button>
      </StepFooter>
    </div>
  )
}
