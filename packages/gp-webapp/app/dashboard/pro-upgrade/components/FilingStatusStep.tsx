'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, cn } from '@styleguide'
import { StepFooter } from 'app/dashboard/shared/StepFooter'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { updateCampaign } from 'app/onboarding/shared/ajaxActions'
import { PRO_UPGRADE_STEP, type ProUpgradeStep } from '../proUpgradeStep'
import { useProUpgradeWizard } from './ProUpgradeWizard'

interface FilingStatusOption {
  // Persisted to campaign.details.hasFiledForRace.
  hasFiled: boolean
  title: string
  description: string
  event: string
  // "Yes" → the EIN step; "No" → the filing-instructions dead-end (task 08),
  // which is off the linear step order, so we navigate explicitly rather than
  // via goToNextStep.
  nextStep: ProUpgradeStep
}

// Guidance comes ahead of this question, so "yes" goes straight to the EIN
// step instead of doubling back.
const OPTIONS: FilingStatusOption[] = [
  {
    hasFiled: true,
    title: 'Yes',
    description: 'I have filed with my election authority.',
    event: EVENTS.ProUpgrade.Compliance.FilingStatusAlreadyFiled,
    nextStep: PRO_UPGRADE_STEP.EIN,
  },
  {
    hasFiled: false,
    title: 'No',
    description: 'I have not filed yet.',
    event: EVENTS.ProUpgrade.Compliance.FilingStatusNotFiled,
    nextStep: PRO_UPGRADE_STEP.FILING_INSTRUCTIONS,
  },
]

const FilingStatusStep = (): React.JSX.Element => {
  const { goToStep, goToPreviousStep } = useProUpgradeWizard()
  const queryClient = useQueryClient()
  const { errorSnackbar } = useSnackbar()
  const [submitting, setSubmitting] = useState(false)
  // The candidate picks a card and confirms with Continue (design: the
  // ballot step).
  const [selected, setSelected] = useState<FilingStatusOption | null>(null)

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
    <div className="flex min-h-full flex-1 flex-col">
      <h1 className="mb-2 text-xl font-semibold">Are you officially filed?</h1>
      <p className="mb-6 text-base text-base-muted-foreground">
        This confirms you are running for office.
      </p>

      <div className="flex flex-col gap-3">
        {OPTIONS.map((option) => {
          const isSelected = selected?.hasFiled === option.hasFiled
          return (
            <button
              key={option.title}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelected(option)}
              disabled={submitting}
              className={cn(
                'flex w-full flex-col items-start gap-0.5 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary disabled:pointer-events-none disabled:opacity-60',
                isSelected
                  ? 'border-primary bg-primary-light/40'
                  : 'border-base-border',
              )}
            >
              <span className="text-[15px] font-semibold">{option.title}</span>
              <span className="text-[13px] text-base-muted-foreground">
                {option.description}
              </span>
            </button>
          )
        })}
      </div>

      <StepFooter>
        <Button
          variant="ghost"
          size="large"
          className="w-full sm:w-auto"
          onClick={goToPreviousStep}
        >
          Back
        </Button>
        <Button
          size="large"
          className="w-full sm:w-auto sm:min-w-[360px]"
          disabled={selected === null}
          loading={submitting}
          onClick={() => {
            if (selected) void handleSelect(selected)
          }}
        >
          Continue
        </Button>
      </StepFooter>
    </div>
  )
}

export default FilingStatusStep
