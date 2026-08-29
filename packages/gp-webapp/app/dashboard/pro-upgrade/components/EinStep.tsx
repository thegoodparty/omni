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
import { StyledAlert } from '@shared/alerts/StyledAlert'
import { EinCheckInput } from 'app/dashboard/shared/EinCheckInput'
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
  // Continue is always enabled (Figma 7490:26881); an attempt with an
  // incomplete EIN surfaces the error banner instead of silently doing nothing.
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  // Once the candidate edits the field we stop syncing from the persisted value.
  const hasInteracted = useRef(false)

  useEffect(() => {
    trackEvent(EVENTS.ProUpgrade.Compliance.EinViewed)
  }, [])

  // Sync the field from the persisted EIN until the candidate edits it. This
  // also covers a campaign query that resolves *after* first render (no SSR
  // initialData), which a one-time useState initializer would miss — leaving a
  // returning candidate's saved EIN unpopulated. A prefilled complete-but-bad
  // EIN also marks the step as attempted so the error banner survives editing
  // (retyping makes the value incomplete, flipping the live verdict back to
  // neutral, but the candidate was routed here to fix it — the guidance must
  // not vanish before anything is fixed).
  useEffect(() => {
    if (!hasInteracted.current) {
      setEinInputValue(persistedEin)
    }
    // Not behind the interaction guard: a bad EIN resolving after the
    // candidate already started typing still needs the guidance to show.
    if (einIndicatorState(persistedEin) === false) setAttemptedSubmit(true)
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

    if (!checkEinSanity(einInputValue).valid) {
      setAttemptedSubmit(true)
      return
    }

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

  const einSanity = checkEinSanity(einInputValue)
  // A `format` failure means the EIN simply isn't fully entered, so the banner
  // asks for it (Figma 7490:26881); a complete-but-bad EIN gets the specific
  // sanity reason instead.
  const einErrorMessage = einSanity.valid
    ? null
    : einSanity.reason === 'format'
      ? 'Please add your campaign EIN'
      : einSanity.message
  // The error shows immediately for a complete-but-bad EIN
  // (`validatedEin === false` — entry derivation routes candidates here
  // specifically to fix one, so a neutral field would give them nothing to act
  // on) and only after an attempted Continue for an incomplete one.
  const showEinError =
    einErrorMessage !== null && (attemptedSubmit || validatedEin === false)

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

      {showEinError && (
        <StyledAlert severity="error" className="mb-6">
          <Body2>{einErrorMessage}</Body2>
        </StyledAlert>
      )}

      <EinCheckInput
        name="ein-number"
        value={einInputValue}
        validated={validatedEin}
        setValidated={setValidatedEin}
        error={showEinError}
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
      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button
          variant="outline"
          size="large"
          className="w-full sm:w-auto"
          onClick={goToPreviousStep}
        >
          Back
        </Button>
        <Button
          size="large"
          className="w-full sm:w-auto"
          onClick={() => void handleNextClick()}
          disabled={submitting}
        >
          Continue
        </Button>
      </div>
    </div>
  )
}

export default EinStep
