'use client'

import type {
  OutreachPurpose,
  ServeOutreachPurpose,
} from '@goodparty_org/contracts'
import { Card, cn } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'

// Every slug a goal card on this step can carry: the canonical Win outreach
// vocabulary and its Serve counterpart. Phone banking and door knocking both
// draw their cards from those two lists, so the step needs no channel type —
// social's extra `issue_update` value belongs to social's own step, which
// keeps its own copy of this for that reason.
export type OutreachStepPurpose = OutreachPurpose | ServeOutreachPurpose

interface PurposeStepProps {
  purposes: {
    id: OutreachStepPurpose
    label: string
  }[]
  selected: OutreachStepPurpose | null
  onSelect: (purpose: OutreachStepPurpose) => void
}

// The channel-neutral goal cards. The intro block (channel badge, title,
// caption) is the CALLER's, not this step's: door knocking renders one intro
// for its whole flow, so a step that drew its own would say the stage title
// twice there.
//
// Picking a card IS the advance, so this step has no footer CTA — every flow
// that mounts it renders none for its purpose step.
export const PurposeStep = ({
  purposes,
  selected,
  onSelect,
}: PurposeStepProps) => (
  <div className="space-y-3">
    {purposes.map((purpose) => (
      <Card
        key={purpose.id}
        role="button"
        tabIndex={0}
        aria-pressed={purpose.id === selected}
        onClick={() => onSelect(purpose.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect(purpose.id)
          }
        }}
        className={cn(
          'cursor-pointer flex-row items-center justify-between gap-3 rounded-lg p-4 transition-colors',
          purpose.id === selected
            ? 'border-primary'
            : 'hover:border-primary/50',
        )}
      >
        <span className="font-medium text-foreground">{purpose.label}</span>
        <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
      </Card>
    ))}
  </div>
)
