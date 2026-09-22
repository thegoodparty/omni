'use client'

import { Button, ProBadge } from '@styleguide'
import {
  INTERSTITIAL_COPY,
  type GateChannel,
} from 'app/dashboard/outreach/v2/gate/gateCopy'
import { ProPitchPanel } from 'app/dashboard/outreach/v2/gate/ProPitchPanel'
import { useProUpgradeWizard } from './ProUpgradeWizard'

// The "join Pro to send this campaign" pause screen (design: the pause screen
// in sgBody): reached only via ProUpgradeFlow's initialStep, ahead of the
// guidance step, when a candidate is gated out of an outreach channel
// mid-draft.
const InterstitialStep = (): React.JSX.Element => {
  const { channel, goToNextStep, exit } = useProUpgradeWizard()
  // No caller has mounted this off a channel-less surface — channel is set
  // whenever an outreach flow launches the wizard on this step — but sms is
  // the safest fallback shape (the two-step texting-plus-verification copy).
  const gateChannel: GateChannel = channel ?? 'sms'

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <ProBadge size="large" className="h-[30px] w-[66px]" />
      <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">
        {INTERSTITIAL_COPY.title}
      </h3>
      <ProPitchPanel channel={gateChannel} />
      <div className="flex w-full flex-col items-center gap-3">
        <Button
          size="large"
          className="w-full sm:w-auto sm:min-w-[360px]"
          onClick={goToNextStep}
        >
          {INTERSTITIAL_COPY.cta}
        </Button>
        <Button
          variant="ghost"
          size="large"
          className="w-full sm:w-auto"
          onClick={exit}
        >
          {INTERSTITIAL_COPY.dismiss}
        </Button>
      </div>
    </div>
  )
}

export default InterstitialStep
