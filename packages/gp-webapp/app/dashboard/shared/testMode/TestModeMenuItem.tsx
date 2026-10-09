'use client'

import { useState } from 'react'
import { FlaskConicalIcon } from '@styleguide/components/ui/icons'
import { useFlagOn } from 'app/shared/experiments/FeatureFlagsProvider'
import { useUser } from '@shared/hooks/useUser'
import { TestModeSheet } from './TestModeSheet'

// Staff-only sidebar item for Test mode. Gated by both the feature flag and
// a @goodparty.org email check so it never surfaces to candidates.
export const TestModeMenuItem = (): React.JSX.Element | null => {
  const [user] = useUser()
  const { on: flagOn } = useFlagOn('staff-test-mode', { trackExposure: false })
  const [sheetOpen, setSheetOpen] = useState(false)

  if (!flagOn) return null
  if (!user?.email?.toLowerCase().endsWith('@goodparty.org')) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <FlaskConicalIcon className="size-4 shrink-0" aria-hidden />
        <span>Test mode</span>
      </button>
      <TestModeSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  )
}
