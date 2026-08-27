'use client'

import { useCandidateProfileForm } from 'app/dashboard/profile/texting-compliance/candidate-profile/useCandidateProfileForm'
import CandidateProfileFields from 'app/dashboard/profile/texting-compliance/candidate-profile/components/CandidateProfileFields'
import { useProUpgradeWizard } from './ProUpgradeWizard'
import WizardStepFooter from './WizardStepFooter'
import WizardHeading from './WizardHeading'

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
      <WizardHeading
        proBadge
        title="What is your campaign about?"
        subtitle="We need to submit your candidate profile to register your campaign. Please be as descriptive as possible to ensure your profile is approved."
      />

      <CandidateProfileFields form={form} />

      <WizardStepFooter
        back={{ onClick: goToPreviousStep }}
        primary={{
          onClick: () => void form.handleSubmit(),
          loading: form.submitting,
          loadingText: 'Saving',
        }}
      />
    </div>
  )
}

export default CandidateProfileStep
