import { Input, Label } from '@styleguide'
import type { DayRangeField } from '../shared/recommendedListFilters.config'
import type { VoterFileFilters } from '../shared/voterFileFilterTransform.util'

interface DayRangeFilterProps {
  field: DayRangeField
  filters: VoterFileFilters
  onFiltersChange: (filters: VoterFileFilters) => void
}

const dayOf = (value: VoterFileFilters[string] | undefined): string =>
  typeof value === 'string' ? value : ''

// A From and To day under a filter group, either end optional. The days
// are inclusive and travel as YYYY-MM-DD, exactly what a date input holds.
export default function DayRangeFilter({
  field,
  filters,
  onFiltersChange,
}: DayRangeFilterProps): React.JSX.Element {
  const from = dayOf(filters[field.fromKey])
  const to = dayOf(filters[field.toKey])
  const setDay = (key: string, value: string) =>
    onFiltersChange({ ...filters, [key]: value })

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-1">
        <Label
          htmlFor={`${field.key}-from`}
          className="text-xs text-muted-foreground"
        >
          From
        </Label>
        <Input
          id={`${field.key}-from`}
          type="date"
          value={from}
          max={to || undefined}
          aria-label={`${field.label} from`}
          onChange={(event) => setDay(field.fromKey, event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label
          htmlFor={`${field.key}-to`}
          className="text-xs text-muted-foreground"
        >
          To
        </Label>
        <Input
          id={`${field.key}-to`}
          type="date"
          value={to}
          min={from || undefined}
          aria-label={`${field.label} to`}
          onChange={(event) => setDay(field.toKey, event.target.value)}
        />
      </div>
    </div>
  )
}
