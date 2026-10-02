'use client'

import { useState } from 'react'
import * as Sentry from '@sentry/nextjs'
import { useToast } from '@/components/Toast'
import { describeActionFailure } from '@/shared/util/actionFailure.util'
import { overrideCvValidationAndResubmit } from '@/app/dashboard/campaigns/actions'

// The one place the override-and-resubmit flow and its toast copy live —
// shared by the user-page hold widget (CvValidationHold) and the 10DLC
// status page so the two surfaces cannot drift.
export function useCvHoldOverride(
  campaignId: number,
  onResolved?: () => Promise<void> | void
) {
  const { showToast } = useToast()
  const [overriding, setOverriding] = useState(false)
  const [overridden, setOverridden] = useState(false)

  async function override() {
    setOverriding(true)
    try {
      const { retriedRunId, retryError } =
        await overrideCvValidationAndResubmit(campaignId)
      setOverridden(true)
      showToast(
        retryError
          ? `Hold cleared, but resubmitting failed: ${retryError}`
          : retriedRunId
            ? 'Hold cleared — registration resubmitted'
            : 'Hold cleared — the next sweep will resubmit'
      )
      await onResolved?.()
    } catch (error) {
      Sentry.captureException(error)
      showToast(
        describeActionFailure(error, 'Failed to override CV validation')
      )
    }
    setOverriding(false)
  }

  return { override, overriding, overridden }
}
