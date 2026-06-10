'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@styleguide'
import Body2 from '@shared/typography/Body2'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { updateCampaign } from 'app/onboarding/shared/ajaxActions'
import { EinCheckInput } from 'app/dashboard/pro-sign-up/committee-check/components/EinCheckInput'
import {
  checkEinSanity,
  einIndicatorState,
} from '@shared/inputs/EinSanityCheck'
import { useProUpgradeWizard } from './ProUpgradeWizard'

// Front-end EIN collection, Phase 1 style: format + sanity only, no backend /
// IRS verification (Peerly stays the downstream backstop for a truly bad EIN).
// Reuses the exact validation the committee-check page uses so the client and
// server sanity layers can't drift: `einIndicatorState` drives the field icon
// and `checkEinSanity` gates submit.
const EinStep = (): React.JSX.Element => {
  const { goToNextStep, goToPreviousStep } = useProUpgradeWizard()
  const [campaign] = useCampaign()
  const queryClient = useQueryClient()
  const { errorSnackbar } = useSnackbar()

  const persistedEin = campaign?.details?.einNumber ?? ''
  const [einInputValue, setEinInputValue] = useState(persistedEin)
  // Initialize to the full sanity-aware verdict, including `false` for a
  // prefilled complete-but-bad EIN (a legacy save predating the sanity rules).
  // Entry derivation routes those candidates here on purpose, so the red
  // indicator and inline reason must show immediately — a neutral field with a
  // disabled Continue would give them nothing to act on.
  const [validatedEin, setValidatedEin] = useState<boolean | null>(() =>
    einIndicatorState(persistedEin),
  )
  const [submitting, setSubmitting] = useState(false)
  // Once the candidate edits the field we stop syncing from the persisted value.
  const hasInteracted = useRef(false)

  useEffect(() => {
    trackEvent(EVENTS.ProUpgrade.Compliance.EinViewed)
  }, [])

  // Sync the field from the persisted EIN until the candidate edits it. This
  // also covers a campaign query that resolves *after* first render (no SSR
  // initialData), which a one-time useState initializer would miss — leaving a
  // returning candidate's saved EIN unpopulated.
  useEffect(() => {
    if (hasInteracted.current) return
    setEinInputValue(persistedEin)
  }, [persistedEin])

  // Recompute the verdict whenever the value changes. `einIndicatorState` is
  // sanity-aware: true for a complete, plausible EIN, false for a
  // complete-but-bad one (placeholder / non-IRS prefix), null while still
  // typing.
  useEffect(() => {
    setValidatedEin(einIndicatorState(einInputValue))
  }, [einInputValue])

  const onEinChange = (value: string): void => {
    hasInteracted.current = true
    setEinInputValue(value)
  }

  const handleNextClick = async (): Promise<void> => {
    // Guard against a double-tap firing two updates / navigations.
    if (submitting) return

    // Defense-in-depth: the button is disabled while the EIN fails sanity
    // (placeholder, non-IRS prefix), but never persist a bad EIN even if that
    // gate is somehow bypassed.
    if (!checkEinSanity(einInputValue).valid) return

    setSubmitting(true)
    const updated = await updateCampaign([
      { key: 'details.einNumber', value: einInputValue },
      { key: 'details.validatedEin', value: true },
    ])

    // updateCampaign swallows API errors and returns false. Advancing anyway
    // would strand an un-persisted EIN, so the step would re-prompt on return —
    // surface the failure and let the candidate retry instead.
    if (!updated) {
      errorSnackbar('Something went wrong. Please try again.')
      setSubmitting(false)
      return
    }

    // Track only after the write commits, so a failed persist isn't counted as
    // a continue (matching the wizard's other steps).
    trackEvent(EVENTS.ProUpgrade.Compliance.EinContinue)
    // The cache write is load-bearing: ProUpgradeEntry derives the resume step
    // from the campaign in this cache, so without it a returning candidate is
    // re-asked for the EIN they just entered.
    queryClient.setQueryData(CAMPAIGN_QUERY_KEY, updated)
    goToNextStep()
    setSubmitting(false)
  }

  // `validatedEin` is sanity-aware, so this keeps Continue disabled for a
  // complete-but-bad EIN (consistent with the red field indicator).
  const nextDisabled = !validatedEin || submitting

  // When `validatedEin === false` the EIN is complete but failed sanity; surface
  // the specific reason inline (the disabled button can't be clicked to show it).
  const einSanity = checkEinSanity(einInputValue)

  return (
    <div>
      <h1 className="text-[32px] leading-[44px] font-semibold mb-1.5">
        What is your campaign EIN?
      </h1>
      <Body2 className="text-base-muted-foreground mb-6">
        Every campaign needs one to access voter data and texting. If you
        don&apos;t have one for your campaign, you can get a free EIN from the
        IRS in just a few minutes.
      </Body2>

      <EinCheckInput
        name="ein-number"
        value={einInputValue}
        validated={validatedEin}
        setValidated={setValidatedEin}
        error={validatedEin === false}
        onChange={onEinChange}
        onTooltipOpen={() =>
          trackEvent(EVENTS.ProUpgrade.Compliance.EinHoverHelp)
        }
        helperText={
          <a
            href="https://sa.www4.irs.gov/applyein/legalStructure"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Get a free EIN in 3-5 minutes (irs.gov)
          </a>
        }
      />
      {validatedEin === false && !einSanity.valid && (
        <Body2 className="text-error my-4 text-center">
          {einSanity.message}
        </Body2>
      )}

      <div className="mt-8 flex justify-between">
        <Button variant="outline" size="large" onClick={goToPreviousStep}>
          Back
        </Button>
        <Button
          size="large"
          onClick={() => void handleNextClick()}
          disabled={nextDisabled}
        >
          Continue
        </Button>
      </div>
    </div>
  )
}

export default EinStep
