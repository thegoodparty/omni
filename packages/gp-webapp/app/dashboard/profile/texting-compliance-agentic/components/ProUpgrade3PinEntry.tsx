'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import {
  Button,
  Card,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@styleguide'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'
import { useSubmitCvPin } from 'app/dashboard/profile/texting-compliance/shared/useSubmitCvPin'
import { describePinDelivery } from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import type { PinDelivery } from '@goodparty_org/contracts'
import type { TcrCompliance } from 'helpers/types'

const PIN_LENGTH = 6

interface ProUpgrade3PinEntryProps {
  tcrCompliance: TcrCompliance
  pinDelivery?: PinDelivery | null
}

// The `submitted` (awaiting-PIN) state of the Pro-upgrade compliance surface,
// shared verbatim by both mount points (the dashboard home card and the
// profile texting-compliance card) so the design can't drift between them.
// The submit path is shared via useSubmitCvPin: a successful submit invalidates
// the TCR query and the surface re-renders to the in-review state.
export default function ProUpgrade3PinEntry({
  tcrCompliance,
  pinDelivery,
}: ProUpgrade3PinEntryProps): React.JSX.Element {
  const [pin, setPin] = useState('')
  const { submit, submitting, error } = useSubmitCvPin(tcrCompliance, {
    // Clear the just-typed digits so the card doesn't keep a submitted PIN on
    // screen if the post-submit refetch hasn't yet flipped the status.
    onSuccess: () => setPin(''),
  })

  // Mirror EnterPin's funnel "viewed" signal so this surface, which sees PIN
  // entry in-place instead of on /enter-pin, still reports it.
  const viewTrackedRef = useRef(false)
  useEffect(() => {
    if (viewTrackedRef.current) return
    viewTrackedRef.current = true
    trackEvent(EVENTS.ProUpgrade.Compliance.PinEntryViewed)
  }, [])

  const isComplete = pin.length === PIN_LENGTH

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    if (!isComplete || submitting) return
    void submit(pin)
  }

  return (
    <Card
      className="relative overflow-hidden gap-0 p-6 mt-4"
      id="texting-compliance"
    >
      <Image
        src="/images/dashboard/pin-decoration.svg"
        alt=""
        width={160}
        height={172}
        aria-hidden
        className="pointer-events-none absolute right-0 top-1/2 hidden h-[172px] w-[160px] -translate-y-1/2 select-none md:block"
      />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 flex max-w-[422px] flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold text-card-foreground">
            Enter your PIN
          </p>
          <p className="text-sm text-base-muted-foreground">
            {describePinDelivery(pinDelivery) ??
              'You will be sent a PIN within 7 business days to your email, ' +
                'phone or address.'}
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-2">
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
                  className="size-10"
                  aria-invalid={Boolean(error) || undefined}
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <Button
            type="submit"
            size="medium"
            disabled={!isComplete || submitting}
            loading={submitting}
          >
            Submit
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </Card>
  )
}
