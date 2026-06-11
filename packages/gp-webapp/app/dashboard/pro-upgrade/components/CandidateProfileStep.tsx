'use client'

import { Button } from '@styleguide'
import Body2 from '@shared/typography/Body2'
import { useCandidateProfileForm } from 'app/dashboard/profile/texting-compliance/candidate-profile/useCandidateProfileForm'
import CandidateProfileFields from 'app/dashboard/profile/texting-compliance/candidate-profile/components/CandidateProfileFields'
import { useProUpgradeWizard } from './ProUpgradeWizard'

// The candidate-profile wizard step. Mounts the shared candidate-profile form
// (bio + policy priorities) rather than forking it: the bio-length and
// policy-count validators live in `candidateProfile.utils` and the save path is
// `useCandidateProfileForm`, both shared with the standalone profile page. On a
// valid save it advances to the payment step. The campaign image from the Figma
// is intentionally not collected here — it comes from BallotReady via gp-api and
// is never asked of the candidate (ENG-10332 product decision).
const CandidateProfileStep = (): React.JSX.Element => {
  const { goToNextStep, goToPreviousStep } = useProUpgradeWizard()
  const form = useCandidateProfileForm({
    onSaved: goToNextStep,
    trackViewEvent: true,
  })

  return (
    <div>
      <h1 className="text-[32px] leading-[44px] font-semibold mb-1.5">
        What is your campaign about?
      </h1>
      <Body2 className="text-base-muted-foreground mb-6">
        We need to submit your candidate profile to register your campaign.
        Please be as descriptive as possible to ensure your profile is approved.
      </Body2>

      <CandidateProfileFields form={form} />

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
          onClick={() => void form.handleSubmit()}
          loading={form.submitting}
          loadingText="Saving"
        >
          Continue
        </Button>
      </div>
    </div>
  )
}

export default CandidateProfileStep
