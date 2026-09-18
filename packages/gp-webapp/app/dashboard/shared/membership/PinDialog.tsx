'use client'

import { useEffect, useState } from 'react'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  Spinner,
} from '@styleguide'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { TcrCompliance } from 'helpers/types'
import {
  CV_PIN_GATE,
  useCvPinGate,
} from 'app/dashboard/profile/texting-compliance/shared/useCvPinGate'
import { useSubmitCvPin } from 'app/dashboard/profile/texting-compliance/shared/useSubmitCvPin'
import CvVerificationInProgressNotice from 'app/dashboard/profile/texting-compliance/shared/CvVerificationInProgressNotice'
import { describePinDelivery } from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'

const PIN_LENGTH = 6

interface PinDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Callers only open this once the TCR read has settled (the membership
  // hook's `ready`), so null here means genuinely no record — not "still
  // loading" — and showing only Close is the right answer.
  tcrCompliance: TcrCompliance | null
}

// The membership banner's PIN entry. Gated on the live CampaignVerify status
// (useCvPinGate) so it never shows a box before a PIN exists (ENG-10866).
export const PinDialog = ({
  open,
  onOpenChange,
  tcrCompliance,
}: PinDialogProps): React.JSX.Element => {
  const [pin, setPin] = useState('')
  const gate = useCvPinGate(tcrCompliance)
  const { submit, submitting, error } = useSubmitCvPin(tcrCompliance, {
    onSuccess: () => {
      setPin('')
      onOpenChange(false)
    },
  })

  useEffect(() => {
    if (open) trackEvent(EVENTS.ProUpgrade.Compliance.PinEntryViewed)
  }, [open])

  const isComplete = pin.length === PIN_LENGTH

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Enter your PIN</DialogTitle>
          <DialogDescription>
            {describePinDelivery(gate.pinDelivery) ??
              'We send a PIN to the email, phone, or address on your campaign filing.'}
          </DialogDescription>
        </DialogHeader>
        {gate.state === CV_PIN_GATE.LOADING && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}
        {gate.state === CV_PIN_GATE.VERIFICATION_IN_PROGRESS && (
          <CvVerificationInProgressNotice />
        )}
        {gate.state === CV_PIN_GATE.READY && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (isComplete && !submitting) void submit(pin)
            }}
            className="flex flex-col gap-4"
          >
            <div className="flex justify-center">
              <InputOTP
                maxLength={PIN_LENGTH}
                value={pin}
                onChange={setPin}
                disabled={submitting}
                aria-label="PIN"
                pattern={REGEXP_ONLY_DIGITS}
              >
                <InputOTPGroup>
                  {Array.from({ length: PIN_LENGTH }, (_, index) => (
                    <InputOTPSlot
                      key={index}
                      index={index}
                      className="size-12"
                      aria-invalid={Boolean(error) || undefined}
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter className="sm:justify-center">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Later
              </Button>
              <Button
                type="submit"
                disabled={!isComplete || submitting}
                loading={submitting}
              >
                Verify PIN
              </Button>
            </DialogFooter>
          </form>
        )}
        {gate.state === CV_PIN_GATE.NOT_AWAITING_PIN && (
          <DialogFooter className="sm:justify-center">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
