'use client'

import { RadioCardItem, RadioGroup } from '@styleguide'
import { getContactsLabels } from '../../../shared/contactsLabels'

export type ListWizardBranch = 'activity' | 'voterFile'

interface BranchStepProps {
  selected: ListWizardBranch | null
  onSelect: (branch: ListWizardBranch) => void
  isWinContext: boolean
}

// Step 1 of the wizard (ENG-10708 locked design, ENG-10721 card copy): the
// branch chooser. Both Win and Serve get the identical two CARDS, but their
// description text names voters/constituents — that noun must come from
// contactsLabels.ts (never a local literal) so Win can't say "constituent"
// and Serve can't say "voter file" (app/dashboard/contacts/CLAUDE.md's
// naming-never-crosses-over rule). Serve is built "as if it has outreach"
// (the activity branch's campaign picker just renders empty for Serve, see
// ActivityStep).
export default function BranchStep({
  selected,
  onSelect,
  isWinContext,
}: BranchStepProps) {
  const labels = getContactsLabels(isWinContext)

  return (
    <RadioGroup
      value={selected ?? ''}
      onValueChange={(value) => onSelect(value as ListWizardBranch)}
      className="gap-4"
    >
      <RadioCardItem
        id="list-wizard-branch-activity"
        value="activity"
        title="Build my list using outreach activity."
        description={labels.wizardActivityBranchDescription}
        className="p-4"
      />
      <RadioCardItem
        id="list-wizard-branch-voter-file"
        value="voterFile"
        title={labels.wizardVoterFileBranchTitle}
        description={labels.wizardVoterFileBranchDescription}
        className="p-4"
      />
    </RadioGroup>
  )
}
