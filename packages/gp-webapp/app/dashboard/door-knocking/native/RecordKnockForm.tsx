import type { ComponentProps } from 'react'
import { useIssueCaptureFlag } from 'app/shared/experiments/issueCaptureFlag'
import RecordKnockFormLegacy from './RecordKnockFormLegacy'
import RecordKnockStepForm from './RecordKnockStepForm'

export type { KnockDraft } from './RecordKnockStepForm'

// Issue capture ships behind its flag, and the step drawer ships with it: the
// drawer is where the confirm step lives. Flag off, a canvasser gets the form
// main shipped; flag on, the questions open in a step drawer over the panel.
// Delete RecordKnockFormLegacy when the flag is removed.
const RecordKnockForm = (props: ComponentProps<typeof RecordKnockStepForm>) => {
  const { enabled } = useIssueCaptureFlag()
  return enabled ? (
    <RecordKnockStepForm {...props} />
  ) : (
    <RecordKnockFormLegacy {...props} />
  )
}

export default RecordKnockForm
