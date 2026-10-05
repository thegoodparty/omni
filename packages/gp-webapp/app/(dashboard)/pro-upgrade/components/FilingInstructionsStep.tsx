'use client'

import { useEffect } from 'react'
import { Button } from '@styleguide'
import Body2 from '@shared/typography/Body2'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import FilingInstructionsDetails from '../../shared/FilingInstructionsDetails'
import { useProUpgradeWizard } from './ProUpgradeWizard'

const FilingInstructionsStep = (): React.JSX.Element => {
  const { purchaseOnly, goToPreviousStep, exit } = useProUpgradeWizard()

  useEffect(() => {
    trackEvent(EVENTS.ProUpgrade.Compliance.FilingInstructionsViewed)
  }, [])

  const handleExit = (): void => {
    trackEvent(EVENTS.ProUpgrade.Compliance.FilingInstructionsExit)
    exit()
  }

  return (
    <div>
      <h1 className="text-[32px] leading-[44px] font-semibold mb-1.5">
        {purchaseOnly
          ? 'You are not eligible for Pro yet, but here is how to file for this election'
          : "You're not eligible for Pro yet, but here's how to file for this election"}
      </h1>
      <Body2 className="text-base-muted-foreground mb-6">
        {purchaseOnly
          ? 'Once done, you can come right back and we will have everything ready to go. In the meantime, you still have access to our free campaign tools.'
          : "Once done, you can come right back and we'll have everything ready to go. In the meantime, you still have access to our free campaign tools."}
      </Body2>

      <FilingInstructionsDetails
        onEmail={() =>
          trackEvent(EVENTS.ProUpgrade.Compliance.FilingInstructionsEmail)
        }
      />

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button
          variant="outline"
          size="large"
          className="w-full sm:w-auto"
          onClick={goToPreviousStep}
        >
          Back
        </Button>
        <Button size="large" className="w-full sm:w-auto" onClick={handleExit}>
          {purchaseOnly ? 'Finish later' : 'Continue to dashboard'}
        </Button>
      </div>
    </div>
  )
}

export default FilingInstructionsStep
