'use client'

import { useState, type ComponentProps, type ReactNode } from 'react'
import * as Sentry from '@sentry/nextjs'
import { Button } from '@radix-ui/themes'
import { useToast } from '@/components/Toast'
import { describeActionFailure } from '@/shared/util/actionFailure.util'
import { resendCvPin } from '@/app/dashboard/campaigns/actions'

interface ResendCvPinButtonProps {
  campaignId: number
  size?: ComponentProps<typeof Button>['size']
  icon?: ReactNode
}

// The one resend-PIN control, shared by the user-page 10DLC widget
// (CvPinStatus) and the 10DLC status page so the flow and its toast copy
// cannot drift.
export function ResendCvPinButton({
  campaignId,
  size,
  icon,
}: ResendCvPinButtonProps) {
  const { showToast } = useToast()
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)

  async function handleResend() {
    setResending(true)
    try {
      const { error } = await resendCvPin(campaignId)
      if (error) {
        showToast(error)
      } else {
        setResent(true)
        showToast('CV PIN resent')
      }
    } catch (error) {
      // A rejection here never reached gp-api (deploy skew, expired session),
      // so this catch is the failure's only trace anywhere — report it.
      Sentry.captureException(error)
      showToast(describeActionFailure(error, 'Failed to resend CV PIN'))
    }
    setResending(false)
  }

  return (
    <Button
      size={size}
      variant="outline"
      onClick={handleResend}
      disabled={resending || resent}
    >
      {icon}
      {resent ? 'PIN resent' : resending ? 'Resending...' : 'Resend CV PIN'}
    </Button>
  )
}
