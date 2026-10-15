import { useState } from 'react'
import type { CivicPanelBuildPlanResponse } from '@goodparty_org/contracts'
import { Button, Card } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { SERVE_CITIZENS_PANEL_COPY as COPY } from '../citizensPanelCopy'
import {
  parseWeeklyTime,
  weeklyTimeOf,
  WeeklyTimeField,
} from './WeeklyTimeField'

const FIELD_ID = 'civic-panel-change-weekly-time'

const WeeklyTimeEditor = ({
  hoursPerWeek,
  onPlan,
}: {
  hoursPerWeek: number
  onPlan: (plan: CivicPanelBuildPlanResponse) => void
}) => {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(weeklyTimeOf(hoursPerWeek))
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5 sm:py-4">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm text-muted-foreground">{COPY.yourTime}</p>
          <p className="text-base font-semibold text-foreground">
            {COPY.hoursPerWeek(hoursPerWeek)}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="small"
          className="text-link"
          aria-label={COPY.changeHoursLabel}
          onClick={() => {
            setValue(weeklyTimeOf(hoursPerWeek))
            setFieldError(null)
            setFailed(false)
            setEditing(true)
          }}
        >
          {COPY.changeHours}
        </Button>
      </div>
    )
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = parseWeeklyTime(value)
    if ('error' in parsed) {
      setFieldError(parsed.error)
      document.getElementById(`${FIELD_ID}-hours`)?.focus()
      return
    }
    setFieldError(null)
    setFailed(false)
    setSaving(true)
    try {
      const { data } = await clientRequest(
        'PATCH /v1/contacts/civic-panel/plan',
        { hoursPerWeek: parsed.hours },
      )
      onPlan(data)
      setEditing(false)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="flex flex-col gap-2 px-4 py-3" onSubmit={save} noValidate>
      <p className="text-xs text-muted-foreground">{COPY.changeHoursCaption}</p>
      <WeeklyTimeField
        idPrefix={FIELD_ID}
        value={value}
        onChange={setValue}
        error={fieldError}
      />
      {failed && (
        <p className="text-xs text-destructive" role="alert">
          {COPY.saveHoursError}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="small" loading={saving}>
          {COPY.saveHours}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="small"
          onClick={() => setEditing(false)}
        >
          {COPY.cancel}
        </Button>
      </div>
    </form>
  )
}

/**
 * The panel page's right column, below the plan on a phone: the weekly time
 * the plan is sized from, and Change.
 */
export const CivicPanelRail = ({
  hoursPerWeek,
  onPlan,
}: {
  hoursPerWeek: number
  onPlan: (plan: CivicPanelBuildPlanResponse) => void
}) => (
  <Card className="gap-0 py-0" data-testid="civic-panel-rail">
    <WeeklyTimeEditor hoursPerWeek={hoursPerWeek} onPlan={onPlan} />
  </Card>
)
