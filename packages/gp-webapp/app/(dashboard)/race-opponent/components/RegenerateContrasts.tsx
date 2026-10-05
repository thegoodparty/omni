'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@styleguide'
import { RefreshIcon } from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import { reportErrorToSentry } from '@shared/sentry'

// Contrasts are auto-generated when opponent research completes, but the pairing
// also depends on the candidate's own positions. This re-pairs the existing
// findings against the latest positions without re-running (or paying for) a
// fresh research pass — useful right after the candidate edits their positions.
const RegenerateContrasts = (): React.JSX.Element => {
  const router = useRouter()
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)

  const regenerate = async (): Promise<void> => {
    setBusy(true)
    try {
      const { data } = await clientRequest(
        'POST /v1/campaigns/mine/race-opponent/contrasts/generate',
        {},
      )
      const added = data.contrasts.length
      const review = data.routedToReviewCount
      if (added === 0 && review === 0) {
        successSnackbar(
          'No new contrasts. Update your positions or collect more research.',
        )
      } else {
        const reviewNote = review > 0 ? `, ${review} sent for review` : ''
        successSnackbar(
          `Added ${added} contrast${added === 1 ? '' : 's'}${reviewNote}.`,
        )
      }
      router.refresh()
    } catch (err) {
      reportErrorToSentry(err, { context: 'RegenerateContrasts.regenerate' })
      errorSnackbar("Couldn't refresh contrasts. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="small"
      icon={<RefreshIcon className="size-4" aria-hidden />}
      onClick={regenerate}
      loading={busy}
      loadingText="Refreshing…"
    >
      Refresh contrasts
    </Button>
  )
}

export default RegenerateContrasts
