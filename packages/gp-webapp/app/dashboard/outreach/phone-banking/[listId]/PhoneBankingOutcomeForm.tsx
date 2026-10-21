import type { ComponentProps } from 'react'
import { useIssueCaptureFlag } from 'app/shared/experiments/issueCaptureFlag'
import PhoneBankingOutcomeFormLegacy from './PhoneBankingOutcomeFormLegacy'
import PhoneBankingOutcomeStepForm from './PhoneBankingOutcomeStepForm'

export type { CallDraft } from './PhoneBankingOutcomeStepForm'

// Issue capture ships behind its flag, and the step drawer ships with it: the
// drawer is where the confirm step lives. Flag off, a caller gets the form
// main shipped; flag on, the questions open in a step drawer over the panel.
// Delete PhoneBankingOutcomeFormLegacy when the flag is removed.
const PhoneBankingOutcomeForm = (
  props: ComponentProps<typeof PhoneBankingOutcomeStepForm>,
) => {
  const { enabled } = useIssueCaptureFlag()
  return enabled ? (
    <PhoneBankingOutcomeStepForm {...props} />
  ) : (
    <PhoneBankingOutcomeFormLegacy {...props} />
  )
}

export default PhoneBankingOutcomeForm
