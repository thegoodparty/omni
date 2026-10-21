import {
  PANEL_MAX_HOURS_PER_WEEK,
  PANEL_MIN_HOURS_PER_WEEK,
} from '@goodparty_org/contracts'
import { Input, Label } from '@styleguide'
import RadioGroup, { RadioCardItem } from '@shared/inputs/RadioGroup'
import { SERVE_CITIZENS_PANEL_COPY as COPY } from '../citizensPanelCopy'

const CHOICES = ['1', '2', '3'] as const
const MORE = 'more'

export type WeeklyTime = { choice: string; more: string }

// Where the field opens: an hour a week, or the plan's own time.
export const weeklyTimeOf = (hoursPerWeek: number): WeeklyTime =>
  hoursPerWeek <= CHOICES.length
    ? { choice: String(hoursPerWeek), more: String(CHOICES.length + 1) }
    : { choice: MORE, more: String(hoursPerWeek) }

// The hours picked, or what to fix in the typed number.
export const parseWeeklyTime = (
  value: WeeklyTime,
): { hours: number } | { error: string } => {
  if (value.choice !== MORE) return { hours: Number(value.choice) }
  const trimmed = value.more.trim()
  if (trimmed === '') return { error: COPY.hoursMissing }
  const hours = Number(trimmed)
  return Number.isInteger(hours) &&
    hours >= PANEL_MIN_HOURS_PER_WEEK &&
    hours <= PANEL_MAX_HOURS_PER_WEEK
    ? { hours }
    : { error: COPY.hoursInvalid(PANEL_MAX_HOURS_PER_WEEK) }
}

export const WeeklyTimeField = ({
  idPrefix,
  value,
  onChange,
  error,
}: {
  idPrefix: string
  value: WeeklyTime
  onChange: (value: WeeklyTime) => void
  error: string | null
}) => {
  const moreId = `${idPrefix}-hours`
  return (
    <div className="flex flex-col gap-3">
      <RadioGroup
        name={idPrefix}
        value={value.choice}
        onValueChange={(choice) => onChange({ ...value, choice })}
        className="grid-cols-1 sm:grid-cols-2"
      >
        {CHOICES.map((hours) => (
          <RadioCardItem
            key={hours}
            value={hours}
            id={`${idPrefix}-${hours}`}
            title={COPY.hoursPerWeek(Number(hours))}
          />
        ))}
        <RadioCardItem
          value={MORE}
          id={`${idPrefix}-${MORE}`}
          title={COPY.moreHoursPerWeek}
        />
      </RadioGroup>
      {value.choice === MORE ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={moreId}>{COPY.moreHoursLabel}</Label>
          <Input
            id={moreId}
            type="number"
            inputMode="numeric"
            min={PANEL_MIN_HOURS_PER_WEEK}
            max={PANEL_MAX_HOURS_PER_WEEK}
            step={1}
            className="w-28"
            value={value.more}
            onChange={(event) =>
              onChange({ ...value, more: event.target.value })
            }
            aria-invalid={error !== null}
            {...(error !== null && { 'aria-describedby': `${moreId}-error` })}
          />
          {error !== null && (
            <p id={`${moreId}-error`} className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
