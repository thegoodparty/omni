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
// branch chooser. Win-only since ENG-10750 (reversing the earlier "build
// Serve as if it has outreach" stance): Serve has no outreach, so
// CreateListWizard drops this step entirely there and opens directly on the
// constituent-file filters. The description text still reads its noun from
// contactsLabels.ts (never a local literal) per the
// naming-never-crosses-over rule (app/dashboard/contacts/CLAUDE.md).
export default function BranchStep({
  selected,
  onSelect,
  isWinContext,
}: BranchStepProps) {
  const labels = getContactsLabels(isWinContext)

  // Lovable-locked selected state (ENG-10725): primary border + primary/5
  // background tint + a 2px primary/20 ring, with a check-fill indicator
  // instead of the default radio dot, and a semibold title over the muted
  // description.
  const branchCardClassName =
    'p-5 has-[[data-state=checked]]:bg-primary/5 has-[[data-state=checked]]:ring-2 has-[[data-state=checked]]:ring-primary/20'

  return (
    <RadioGroup
      value={selected ?? ''}
      onValueChange={(value) => onSelect(value as ListWizardBranch)}
      className="gap-4"
    >
      <RadioCardItem
        id="list-wizard-branch-activity"
        value="activity"
        title="Build a list from previous campaign activity"
        description={labels.wizardActivityBranchDescription}
        className={branchCardClassName}
        titleClassName="font-semibold"
        indicator="check"
      />
      <RadioCardItem
        id="list-wizard-branch-voter-file"
        value="voterFile"
        title={labels.wizardVoterFileBranchTitle}
        description={labels.wizardVoterFileBranchDescription}
        className={branchCardClassName}
        titleClassName="font-semibold"
        indicator="check"
      />
    </RadioGroup>
  )
}
