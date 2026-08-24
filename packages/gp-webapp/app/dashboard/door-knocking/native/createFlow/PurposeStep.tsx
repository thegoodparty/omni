import { Card, cn } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
import {
  DOOR_KNOCKING_PURPOSES,
  type DoorKnockingPurpose,
} from './doorKnockingPurposes'

interface PurposeStepProps {
  selected: DoorKnockingPurpose | null
  onSelect: (purpose: DoorKnockingPurpose) => void
}

// Step 1. Picking a card IS the advance, so this step has no footer CTA —
// the shell renders none for it, the same way the outreach flows don't.
export const PurposeStep = ({ selected, onSelect }: PurposeStepProps) => (
  <div className="flex flex-col gap-3">
    {DOOR_KNOCKING_PURPOSES.map((purpose) => (
      <Card
        key={purpose.id}
        role="button"
        tabIndex={0}
        aria-pressed={purpose.id === selected}
        onClick={() => onSelect(purpose.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
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
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-foreground">
            {purpose.label}
          </span>
          <span className="block text-sm text-muted-foreground">
            {purpose.description}
          </span>
        </span>
        <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
      </Card>
    ))}
  </div>
)
