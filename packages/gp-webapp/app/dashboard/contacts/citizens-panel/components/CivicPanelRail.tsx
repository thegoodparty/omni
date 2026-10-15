import { useState } from 'react'
import Link from 'next/link'
import type {
  CivicPanelBuildNext,
  CivicPanelBuildPlanResponse,
} from '@goodparty_org/contracts'
import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { numberFormatter } from 'helpers/numberHelper'
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
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <p className="text-sm text-foreground">
          {COPY.hoursPerWeek(hoursPerWeek)}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="small"
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
 * The panel page's rail, the priority page's "Where this stands" for the
 * panel: how many members of the goal, the one thing to do next, and the
 * weekly time the plan is sized from.
 */
export const CivicPanelRail = ({
  progress,
  next,
  hoursPerWeek,
  onPlan,
}: {
  progress: { members: number; goal: number }
  next: CivicPanelBuildNext | null
  // Null without an active plan, which has no time to change.
  hoursPerWeek: number | null
  onPlan: (plan: CivicPanelBuildPlanResponse) => void
}) => (
  <Card className="gap-0 py-0" data-testid="civic-panel-rail">
    <CardHeader className="gap-1 px-4 pt-4 pb-3">
      <CardTitle className="text-sm">{COPY.railTitle}</CardTitle>
      <CardDescription className="text-xs">
        {COPY.progress(
          numberFormatter(progress.members),
          numberFormatter(progress.goal),
        )}
      </CardDescription>
    </CardHeader>
    {next ? (
      <>
        <Separator />
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">{COPY.next}</p>
          {next.href ? (
            <Link
              href={next.href}
              scroll={false}
              className="text-sm text-link no-underline hover:underline"
            >
              {next.line}
            </Link>
          ) : (
            <p className="text-sm text-foreground">{next.line}</p>
          )}
        </div>
      </>
    ) : null}
    {hoursPerWeek !== null ? (
      <>
        <Separator />
        <WeeklyTimeEditor hoursPerWeek={hoursPerWeek} onPlan={onPlan} />
      </>
    ) : null}
  </Card>
)
