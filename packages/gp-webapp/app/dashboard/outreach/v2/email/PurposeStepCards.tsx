import { Card, cn } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'

interface PurposeStepCardsProps {
  goals: { id: string; label: string }[]
  selected: string | null
  onSelect: (id: string) => void
}

export const PurposeStepCards = ({
  goals,
  selected,
  onSelect,
}: PurposeStepCardsProps) => (
  <div className="space-y-3">
    {goals.map((goal) => (
      <Card
        key={goal.id}
        role="button"
        tabIndex={0}
        aria-pressed={goal.id === selected}
        onClick={() => onSelect(goal.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect(goal.id)
          }
        }}
        className={cn(
          'cursor-pointer flex-row items-center justify-between gap-3 rounded-lg p-4 transition-colors',
          goal.id === selected ? 'border-primary' : 'hover:border-primary/50',
        )}
      >
        <span className="font-medium text-foreground">{goal.label}</span>
        <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
      </Card>
    ))}
  </div>
)
