'use client'

import { useState } from 'react'
import { Button } from '@styleguide'
import { RefreshIcon } from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { useUser } from '@shared/hooks/useUser'
import { useSnackbar } from 'helpers/useSnackbar'

type DispatchType = 'top_community_issues' | 'trending_issues'

const LABELS: Record<DispatchType, string> = {
  top_community_issues: 'top community issues',
  trending_issues: 'trending issues',
}

const StaffDispatchButtons = (): React.JSX.Element | null => {
  const [user] = useUser()
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const [pending, setPending] = useState<DispatchType | null>(null)

  if (!user?.email?.toLowerCase().endsWith('@goodparty.org')) {
    return null
  }

  const dispatch = async (type: DispatchType) => {
    setPending(type)
    try {
      const { data } = await clientRequest(
        'POST /v1/community-issues/self-dispatch',
        { type },
      )
      if (data.dispatched > 0) {
        successSnackbar(`Dispatched a ${LABELS[type]} run for your org.`)
      } else {
        errorSnackbar(
          `No ${LABELS[type]} run dispatched (already running or org not eligible).`,
        )
      }
    } catch {
      errorSnackbar(`Failed to dispatch ${LABELS[type]} run. Please try again.`)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Staff tools
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => dispatch('top_community_issues')}
          disabled={pending !== null}
          className="flex items-center gap-1.5"
        >
          <RefreshIcon className="size-4" aria-hidden />
          Dispatch top community issues
        </Button>
        <Button
          variant="outline"
          onClick={() => dispatch('trending_issues')}
          disabled={pending !== null}
          className="flex items-center gap-1.5"
        >
          <RefreshIcon className="size-4" aria-hidden />
          Dispatch trending issues
        </Button>
      </div>
    </div>
  )
}

export default StaffDispatchButtons
