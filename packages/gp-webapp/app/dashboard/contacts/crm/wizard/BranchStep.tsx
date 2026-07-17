'use client'

import { RadioCardItem, RadioGroup } from '@styleguide'

export type ListWizardBranch = 'activity' | 'voterFile'

interface BranchStepProps {
  selected: ListWizardBranch | null
  onSelect: (branch: ListWizardBranch) => void
}

// Step 1 of the wizard (ENG-10708 locked design): the branch chooser. Both
// Win and Serve get the identical two cards — Serve is built "as if it has
// outreach" (the activity branch's campaign picker just renders empty for
// Serve, see ActivityStep).
export default function BranchStep({ selected, onSelect }: BranchStepProps) {
  return (
    <RadioGroup
      value={selected ?? ''}
      onValueChange={(value) => onSelect(value as ListWizardBranch)}
      className="gap-4"
    >
      <RadioCardItem
        id="list-wizard-branch-activity"
        value="activity"
        title="Build from outreach activity"
        description="Target people based on how they responded to a text, door knock, or robocall campaign."
        className="p-4"
      />
      <RadioCardItem
        id="list-wizard-branch-voter-file"
        value="voterFile"
        title="Build from the voter file"
        description="Filter by demographics, contact info, and support status."
        className="p-4"
      />
    </RadioGroup>
  )
}
