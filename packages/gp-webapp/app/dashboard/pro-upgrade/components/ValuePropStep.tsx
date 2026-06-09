'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button, ProBadge } from '@styleguide'
import { CheckIcon, XMarkIcon } from '@styleguide/components/ui/icons'
import Body2 from '@shared/typography/Body2'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useProUpgradeWizard } from './ProUpgradeWizard'

interface ComparisonRow {
  label: string
  free: boolean
}
// Free-vs-Pro comparison from the Figma. Every row is included in Pro, so only
// the Free column varies.
const COMPARISON_ROWS: ComparisonRow[] = [
  { label: 'Campaign plan', free: true },
  { label: 'Campaign advising', free: false },
  { label: 'Voter data & list building', free: false },
  { label: '10DLC compliance', free: false },
  { label: 'Texts and robocalls', free: false },
  { label: 'Up to 5,000 free texts', free: false },
]

const ROW_GRID =
  'grid grid-cols-[1fr_64px_64px] md:grid-cols-[1fr_100px_100px] items-center'

const ValuePropStep = (): React.JSX.Element => {
  const router = useRouter()
  const { goToNextStep } = useProUpgradeWizard()

  useEffect(() => {
    trackEvent(EVENTS.ProUpgrade.Compliance.ValuePropViewed)
  }, [])

  const handleGetPro = () => {
    trackEvent(EVENTS.ProUpgrade.Compliance.ValuePropGetPro)
    goToNextStep()
  }

  const handleMaybeLater = () => {
    trackEvent(EVENTS.ProUpgrade.Compliance.ValuePropMaybeLater)
    router.push('/dashboard')
  }

  return (
    <div>
      <h1 className="text-center text-[32px] leading-[44px] font-semibold mb-1.5">
        76% of candidates who use Pro win
      </h1>
      <Body2 className="text-center text-base-muted-foreground mb-6">
        Get $300 of value for $10/mo.
      </Body2>

      <div className="mb-9">
        <div className={`${ROW_GRID} py-2`}>
          <span />
          <span className="text-center">Free</span>
          <span className="flex justify-center">
            <ProBadge size="large" />
          </span>
        </div>

        {COMPARISON_ROWS.map(({ label, free }) => (
          <div
            key={label}
            className={`${ROW_GRID} border-b last:border-b-0 border-base-border py-3`}
          >
            <span className="underline decoration-dotted">{label}</span>
            <span className="flex justify-center">
              {free ? (
                <CheckIcon className="h-4 w-4 text-blue-400" />
              ) : (
                <XMarkIcon className="h-4 w-4 text-destructive" />
              )}
            </span>
            <span className="flex justify-center">
              <CheckIcon className="h-4 w-4 text-blue-400" />
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center gap-2">
        <Button
          size="large"
          className="w-full sm:w-auto"
          onClick={handleGetPro}
        >
          Get Pro for $10/mo
        </Button>
        <Button variant="ghost" onClick={handleMaybeLater}>
          Maybe later
        </Button>
      </div>
    </div>
  )
}

export default ValuePropStep
