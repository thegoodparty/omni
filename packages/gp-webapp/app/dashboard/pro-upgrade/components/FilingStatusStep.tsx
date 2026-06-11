'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
import Body2 from '@shared/typography/Body2'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { updateCampaign } from 'app/onboarding/shared/ajaxActions'
import { PRO_UPGRADE_STEP, type ProUpgradeStep } from '../proUpgradeStep'
import { useProUpgradeWizard } from './ProUpgradeWizard'

interface FilingStatusOption {
  // Persisted to campaign.details.hasFiledForRace; read back by the wizard
  // index via filingStatusFromDetails so this answer is respected on return.
  hasFiled: boolean
  title: string
  description: string
  event: string
  // "Yes" → the guidance interstitial (task 09); "No" → the filing-instructions
  // dead-end (task 08). Both are off the linear step order, so we navigate to
  // them explicitly rather than via goToNextStep.
  nextStep: ProUpgradeStep
}

const OPTIONS: FilingStatusOption[] = [
  {
    hasFiled: true,
    title: "Yes, I'm already filed",
    description: 'I have my campaign EIN and filing documents ready',
    event: EVENTS.ProUpgrade.Compliance.FilingStatusAlreadyFiled,
    nextStep: PRO_UPGRADE_STEP.GUIDANCE,
  },
  {
    hasFiled: false,
    title: 'No, not yet',
    description: 'I still need to file for this election',
    event: EVENTS.ProUpgrade.Compliance.FilingStatusNotFiled,
    nextStep: PRO_UPGRADE_STEP.FILING_INSTRUCTIONS,
  },
]

const FilingStatusStep = (): React.JSX.Element => {
  const { goToStep, goToPreviousStep } = useProUpgradeWizard()
  const queryClient = useQueryClient()
  const { errorSnackbar } = useSnackbar()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    trackEvent(EVENTS.ProUpgrade.Compliance.FilingStatusViewed)
  }, [])

  const handleSelect = async (option: FilingStatusOption): Promise<void> => {
    // Guard against a double-tap firing two updates / navigations.
    if (submitting) return
    setSubmitting(true)

    const updated = await updateCampaign([
      { key: 'details.hasFiledForRace', value: option.hasFiled },
    ])

    // updateCampaign swallows API errors and returns false. Navigating anyway
    // would strand an un-persisted answer, so re-entry would re-ask the
    // question — surface the failure and let the candidate retry instead.
    if (!updated) {
      errorSnackbar('Something went wrong. Please try again.')
      setSubmitting(false)
      return
    }

    // Track the selection only after the write commits, so analytics don't
    // over-count selections that failed to persist.
    trackEvent(option.event)
    queryClient.setQueryData(CAMPAIGN_QUERY_KEY, updated)
    goToStep(option.nextStep)
    // On a successful navigation this component unmounts and the update is
    // discarded; if router.push fails silently the buttons re-enable so the
    // candidate can retry instead of being stuck on a disabled screen.
    setSubmitting(false)
  }

  return (
    <div>
      <h1 className="text-[32px] leading-[44px] font-semibold mb-1.5">
        Have you already filed for your race?
      </h1>
      <Body2 className="text-base-muted-foreground mb-6">
        In order to get Pro you need to be officially filed as a candidate to
        comply with voter data and texting regulations.
      </Body2>

      <div className="flex flex-col gap-3">
        {OPTIONS.map((option) => (
          <button
            key={option.title}
            type="button"
            onClick={() => void handleSelect(option)}
            disabled={submitting}
            className="flex w-full items-center justify-between gap-4 rounded-xl border border-components-input-border p-4 text-left transition-colors hover:border-primary hover:bg-gray-100 disabled:pointer-events-none disabled:opacity-60"
          >
            <span>
              <span className="block">{option.title}</span>
              <Body2 className="text-base-muted-foreground">
                {option.description}
              </Body2>
            </span>
            <ChevronRightIcon className="h-5 w-5 shrink-0 text-base-foreground" />
          </button>
        ))}
      </div>

      <div className="mt-8">
        <Button variant="outline" size="large" onClick={goToPreviousStep}>
          Back
        </Button>
      </div>
    </div>
  )
}

export default FilingStatusStep
