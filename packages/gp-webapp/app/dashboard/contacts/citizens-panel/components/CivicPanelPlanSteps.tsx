import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { format, subBusinessDays } from 'date-fns'
import {
  PANEL_CALLS_PER_HOUR,
  PANEL_DOORS_PER_HOUR,
  PANEL_TEXT_REPLY_BUSINESS_DAYS,
  UNDERREPRESENTED_GROUP_NAMES,
  type CivicPanelBuildNext,
  type CivicPanelBuildPlan,
  type CivicPanelBuildPlanResponse,
  type CivicPanelBuildStep,
} from '@goodparty_org/contracts'
import { Button, Checkbox, cn } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { numberFormatter } from 'helpers/numberHelper'
import { SERVE_CITIZENS_PANEL_COPY as COPY } from '../citizensPanelCopy'
import { keepGoingHref, useCivicPanelStepFlow } from './useCivicPanelStepFlow'

const CHANNEL_ORDER: CivicPanelBuildStep['channel'][] = [
  'text',
  'phone_banking',
  'door_knocking',
]

const shortDay = (date: Date | string) => format(new Date(date), 'MMM d')

const stepTitle = (step: CivicPanelBuildStep): string => {
  const size = numberFormatter(step.targetSize)
  return step.channel === 'door_knocking'
    ? COPY.stepTitle.door_knocking(size, step.position)
    : COPY.stepTitle[step.channel](size)
}

// A text counts as done once it is sent: waiting on its replies is part of
// done, never a state of its own.
const isDone = (step: CivicPanelBuildStep): boolean =>
  step.status === 'done' ||
  (step.channel === 'text' && step.status === 'waiting_on_replies')

// The day a text goes out: its replies are due a few business days after.
const sendDay = (step: CivicPanelBuildStep): Date | null =>
  step.expectedRepliesBy
    ? subBusinessDays(
        new Date(step.expectedRepliesBy),
        PANEL_TEXT_REPLY_BUSINESS_DAYS,
      )
    : step.startedAt
      ? new Date(step.startedAt)
      : null

const minutesOf = (step: CivicPanelBuildStep): number =>
  (step.targetSize /
    (step.channel === 'door_knocking'
      ? PANEL_DOORS_PER_HOUR
      : PANEL_CALLS_PER_HOUR)) *
  60

// The one line under a step's title.
const stepDetail = (step: CivicPanelBuildStep): string => {
  const joined = numberFormatter(step.joined ?? 0)
  const reached = step.reached === null ? null : numberFormatter(step.reached)
  if (step.channel === 'text') {
    const sent = sendDay(step)
    if (
      step.status === 'waiting_on_replies' &&
      sent &&
      step.expectedRepliesBy
    ) {
      return COPY.sentRepliesBy(
        shortDay(sent),
        shortDay(step.expectedRepliesBy),
      )
    }
    if (step.status === 'done' && sent) {
      return COPY.sentJoined(shortDay(sent), joined)
    }
    if (step.status === 'in_progress' && sent) {
      return COPY.textGoesOut(format(sent, 'EEEE, MMMM d'))
    }
    return step.steeredToward && step.status === 'not_started'
      ? COPY.stepLean.text(UNDERREPRESENTED_GROUP_NAMES[step.steeredToward])
      : COPY.stepDetail.text
  }
  const calls = step.channel === 'phone_banking'
  if (step.status === 'done') {
    if (reached === null) return COPY.joined(joined)
    return calls
      ? COPY.calledJoined(reached, joined)
      : COPY.knockedJoined(reached, joined)
  }
  if (step.status === 'in_progress' && reached !== null) {
    return calls ? COPY.calledSoFar(reached) : COPY.knockedSoFar(reached)
  }
  const time = COPY.duration(minutesOf(step))
  if (calls) return COPY.stepDetail.phone_banking(time)
  return step.steeredToward === 'unreachedAreas'
    ? COPY.stepLean.door_knocking(time)
    : COPY.stepDetail.door_knocking(time)
}

/**
 * The plan as one checklist: the next step first and largest, with the one
 * primary action and Skip; the other open steps as compact rows with Get
 * started; and the done steps checked at the bottom. A text checks itself
 * once it is sent; a call list or a walk checks itself once it is worked
 * through, and the official can tick or untick it by hand. A step's action
 * opens the standard flow for its channel (useCivicPanelStepFlow).
 */
export const CivicPanelPlanSteps = ({
  plan,
  next,
  onPlan,
}: {
  plan: CivicPanelBuildPlan
  next: CivicPanelBuildNext | null
  onPlan: (plan: CivicPanelBuildPlanResponse) => void
}) => {
  const focusedStepId = useSearchParams()?.get('step') ?? null
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<{
    stepId: string
    message: string
  } | null>(null)

  useEffect(() => {
    if (!focusedStepId) return
    document
      .getElementById(`panel-step-${focusedStepId}`)
      ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [focusedStepId])

  const refresh = async () => {
    const result = await clientRequest(
      'GET /v1/contacts/civic-panel/plan',
      {},
    ).catch(() => null)
    if (result) onPlan(result.data)
  }

  const fail = (stepId: string, message: string) =>
    setError({ stepId, message })

  const stepFlow = useCivicPanelStepFlow({ onChange: refresh })

  const start = async (step: CivicPanelBuildStep) => {
    setPendingId(step.id)
    setError(null)
    try {
      // Leaving for the door knocking page keeps the button loading.
      if ((await stepFlow.open(step)) === 'navigating') return
    } catch {
      fail(step.id, COPY.stepError)
    }
    setPendingId(null)
  }

  const skip = async (step: CivicPanelBuildStep) => {
    setPendingId(step.id)
    setError(null)
    try {
      const { data } = await clientRequest(
        'POST /v1/contacts/civic-panel/plan/steps/:id/skip',
        { id: step.id },
      )
      onPlan(data)
    } catch {
      fail(step.id, COPY.skipError)
    } finally {
      setPendingId(null)
    }
  }

  const mark = async (step: CivicPanelBuildStep, done: boolean) => {
    setPendingId(step.id)
    setError(null)
    try {
      const { data } = await clientRequest(
        'POST /v1/contacts/civic-panel/plan/steps/:id/mark',
        { id: step.id, done },
      )
      onPlan(data)
    } catch {
      fail(step.id, COPY.markError)
    } finally {
      setPendingId(null)
    }
  }

  const byOrder = (a: CivicPanelBuildStep, b: CivicPanelBuildStep) =>
    CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel) ||
    a.position - b.position
  const shown = plan.steps.filter((s) => s.status !== 'skipped')
  const done = shown
    .filter(isDone)
    .sort((a, b) => b.wave - a.wave || byOrder(a, b))
  const open = shown
    .filter((s) => !isDone(s))
    .sort((a, b) => a.wave - b.wave || byOrder(a, b))
  const featured = open.find((s) => s.id === next?.stepId) ?? null
  const rest = open.filter((s) => s !== featured)

  const checkbox = (step: CivicPanelBuildStep) => {
    const checked = isDone(step)
    // A text checks itself once it is sent; nothing to tick by hand.
    const byHand = step.channel !== 'text'
    return (
      <Checkbox
        checked={checked}
        disabled={!byHand || pendingId !== null}
        aria-label={checked ? COPY.markNotDone : COPY.markDone}
        className={cn(
          'size-[22px] rounded-md',
          !byHand && 'disabled:cursor-default disabled:opacity-100',
        )}
        onCheckedChange={(value) => void mark(step, value === true)}
      />
    )
  }

  const actionFor = (step: CivicPanelBuildStep, primary: boolean) => {
    const keepGoing = keepGoingHref(step)
    if (keepGoing && step.channel !== 'text') {
      return (
        <Button
          asChild
          size={primary ? 'large' : 'medium'}
          variant={primary ? 'default' : 'outline'}
          className={cn(primary ? 'flex-1 sm:flex-none' : 'h-11 sm:h-10')}
        >
          <Link href={keepGoing}>{COPY.keepGoing[step.channel]}</Link>
        </Button>
      )
    }
    if (step.status !== 'not_started') return null
    if (step.channel === 'text' && stepFlow.textingOff) {
      return <p className="text-sm text-muted-foreground">{COPY.textingOff}</p>
    }
    return (
      <Button
        type="button"
        size={primary ? 'large' : 'medium'}
        variant={primary ? 'default' : 'outline'}
        className={cn(primary ? 'flex-1 sm:flex-none' : 'h-11 sm:h-10')}
        loading={pendingId === step.id}
        disabled={pendingId !== null && pendingId !== step.id}
        onClick={() => void start(step)}
      >
        {primary ? COPY.startStep[step.channel] : COPY.getStarted}
      </Button>
    )
  }

  const errorFor = (step: CivicPanelBuildStep) =>
    error?.stepId === step.id ? (
      <p className="text-sm text-destructive" role="alert">
        {error.message}
      </p>
    ) : null

  const rowProps = (step: CivicPanelBuildStep) => ({
    id: `panel-step-${step.id}`,
    'data-focused': focusedStepId === step.id,
  })
  const ring = (step: CivicPanelBuildStep) =>
    focusedStepId === step.id && 'rounded-lg ring-2 ring-primary ring-inset'

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-border bg-background">
      <div className="flex flex-col gap-0.5 px-4 pt-4 pb-1 sm:px-6 sm:pt-5 sm:pb-3">
        <h2 className="text-[17px] font-bold text-foreground sm:text-lg">
          {COPY.planTitle}
        </h2>
        <p className="hidden text-sm text-muted-foreground sm:block">
          {COPY.planCaption}
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-border border-t border-border">
        {featured ? (
          <li
            {...rowProps(featured)}
            className={cn(
              'flex flex-col gap-2 px-4 py-5 sm:gap-2.5 sm:p-6',
              ring(featured),
            )}
          >
            <div className="flex items-center gap-3 sm:gap-3.5">
              {checkbox(featured)}
              <h3 className="text-xl font-bold text-foreground sm:text-[22px]">
                {stepTitle(featured)}
              </h3>
            </div>
            <p className="ml-[34px] text-sm text-muted-foreground sm:ml-9 sm:text-base">
              {stepDetail(featured)}
            </p>
            <div className="mt-2 flex items-center gap-3 sm:mt-2.5 sm:ml-9 sm:gap-5">
              {actionFor(featured, true)}
              {featured.status === 'not_started' ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="large"
                  disabled={pendingId !== null}
                  onClick={() => void skip(featured)}
                >
                  {COPY.skipStep}
                </Button>
              ) : null}
            </div>
            <div className="sm:ml-9">{errorFor(featured)}</div>
          </li>
        ) : null}
        {rest.map((step) => {
          const action = actionFor(step, false)
          return (
            <li
              key={step.id}
              {...rowProps(step)}
              className={cn(
                'flex flex-col gap-2 px-4 py-3.5 sm:px-6 sm:py-4',
                ring(step),
              )}
            >
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-3.5">
                {checkbox(step)}
                <div className="flex flex-col gap-0.5">
                  <p className="text-base font-semibold text-foreground">
                    {stepTitle(step)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {stepDetail(step)}
                  </p>
                </div>
                {action ? (
                  <div className="col-start-2 mt-3 justify-self-start sm:col-start-3 sm:row-start-1 sm:mt-0">
                    {action}
                  </div>
                ) : null}
              </div>
              {errorFor(step)}
            </li>
          )
        })}
        {done.map((step) => (
          <li
            key={step.id}
            {...rowProps(step)}
            className={cn(
              'flex flex-col gap-2 px-4 py-3.5 sm:px-6 sm:py-4',
              ring(step),
            )}
          >
            <div className="flex items-center gap-3 sm:gap-3.5">
              {checkbox(step)}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-base font-semibold text-muted-foreground">
                  {stepTitle(step)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {stepDetail(step)}
                </p>
              </div>
            </div>
            {errorFor(step)}
          </li>
        ))}
      </ul>
      {stepFlow.flows}
    </section>
  )
}
