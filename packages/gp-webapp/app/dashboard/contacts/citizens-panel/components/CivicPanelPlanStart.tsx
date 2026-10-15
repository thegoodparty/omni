import { useState } from 'react'
import Link from 'next/link'
import { FetchError } from 'ofetch'
import type { CivicPanelBuildPlanResponse } from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import {
  CHIEF_OF_STAFF_PATH,
  SERVE_CITIZENS_PANEL_COPY as COPY,
} from '../citizensPanelCopy'
import {
  parseWeeklyTime,
  weeklyTimeOf,
  WeeklyTimeField,
} from './WeeklyTimeField'

const FIELD_ID = 'civic-panel-weekly-time'

const messageOf = (error: FetchError): string | null => {
  const message: unknown = error.data?.message
  return typeof message === 'string' ? message : null
}

// The one question the plan needs: the official's own time each week, an
// hour at least, which is where it starts.
export const CivicPanelPlanStart = ({
  onPlan,
}: {
  onPlan: (plan: CivicPanelBuildPlanResponse) => void
}) => {
  const [value, setValue] = useState(weeklyTimeOf(1))
  const [fieldError, setFieldError] = useState<string | null>(null)
  // A refusal the official cannot fix by typing another number, such as
  // nobody left to reach.
  const [blocked, setBlocked] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = parseWeeklyTime(value)
    if ('error' in parsed) {
      setFieldError(parsed.error)
      document.getElementById(`${FIELD_ID}-hours`)?.focus()
      return
    }
    setFieldError(null)
    setBlocked(null)
    setFailed(false)
    setSaving(true)
    try {
      const { data } = await clientRequest(
        'POST /v1/contacts/civic-panel/plan',
        {
          hoursPerWeek: parsed.hours,
        },
      )
      onPlan(data)
    } catch (error) {
      if (error instanceof FetchError && error.status === 409) {
        // A plan made in another tab: show it rather than an error.
        const current = await clientRequest(
          'GET /v1/contacts/civic-panel/plan',
          {},
        ).catch(() => null)
        if (current?.data.plan?.status === 'active') {
          onPlan(current.data)
          return
        }
        setBlocked(messageOf(error) ?? COPY.makePlanRefused)
        return
      }
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-background p-5">
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">
            {COPY.weeklyQuestion}
          </h2>
          <p className="text-sm text-muted-foreground">{COPY.weeklyCaption}</p>
        </div>
        <WeeklyTimeField
          idPrefix={FIELD_ID}
          value={value}
          onChange={setValue}
          error={fieldError}
        />
        <Button type="submit" className="self-start" loading={saving}>
          {COPY.makePlan}
        </Button>
        {blocked !== null && (
          <p className="text-sm text-foreground" role="alert">
            {blocked}.{' '}
            <Link href={CHIEF_OF_STAFF_PATH} className="text-link">
              {COPY.makePlanBlockedAction}
            </Link>
          </p>
        )}
        {failed && (
          <p className="text-sm text-destructive" role="alert">
            {COPY.makePlanError}
          </p>
        )}
      </form>
    </section>
  )
}
