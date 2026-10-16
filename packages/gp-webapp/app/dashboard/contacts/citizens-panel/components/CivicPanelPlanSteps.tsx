import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { format, subBusinessDays } from 'date-fns'
import {
  PANEL_CALLS_PER_HOUR,
  PANEL_DOORS_PER_HOUR,
  PANEL_TEXT_REPLY_BUSINESS_DAYS,
  SERVE_PHONE_BANKING_PURPOSE_VALUES,
  SERVE_SMS_PURPOSE_VALUES,
  type CivicPanelBuildNext,
  type CivicPanelBuildPlan,
  type CivicPanelBuildPlanResponse,
  type CivicPanelBuildStep,
  type PrepareCivicPanelBuildStepResponse,
} from '@goodparty_org/contracts'
import { Button, Checkbox, cn } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { numberFormatter } from 'helpers/numberHelper'
import { useServeSmsFlag } from '@shared/experiments/serveSmsFlag'
import {
  PhoneBankingFlow,
  SERVE_PHONE_BANKING_SURFACE,
} from 'app/dashboard/outreach/v2/phone-banking/PhoneBankingFlow'
import {
  SERVE_SMS_SURFACE,
  SmsFlow,
} from 'app/dashboard/outreach/v2/sms/SmsFlow'
import { walkableAreaParam } from 'app/dashboard/door-knocking/native/walkableAreaParam'
import { SERVE_CITIZENS_PANEL_COPY as COPY } from '../citizensPanelCopy'

type Opened =
  | {
      channel: 'text'
      listId: number
      purpose: (typeof SERVE_SMS_PURPOSE_VALUES)[number]
    }
  | {
      channel: 'phone_banking'
      listId: number
      purpose: (typeof SERVE_PHONE_BANKING_PURPOSE_VALUES)[number]
    }

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
    return COPY.stepDetail.text
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
  return calls
    ? COPY.stepDetail.phone_banking(time)
    : COPY.stepDetail.door_knocking(time)
}

// Where a call list or a walk already underway is worked.
const keepGoingHref = (step: CivicPanelBuildStep): string | null => {
  if (step.status !== 'in_progress') return null
  if (step.channel === 'phone_banking' && step.phoneBankingListId !== null) {
    return `/dashboard/outreach/phone-banking/${step.phoneBankingListId}`
  }
  if (step.channel === 'door_knocking' && step.doorKnockingTurfId !== null) {
    return `/dashboard/door-knocking?walkTurfId=${step.doorKnockingTurfId}`
  }
  return null
}

// The door knocking create flow on the step's list and purpose, with the
// walkable area it drew as the turf's boundary.
const doorFlowHref = (data: PrepareCivicPanelBuildStepResponse): string => {
  const params = new URLSearchParams({
    create: '1',
    listId: String(data.voterFileFilterId),
    purpose: data.purpose,
  })
  const area = data.area ? walkableAreaParam(data.area) : null
  if (area) params.set('area', area)
  return `/dashboard/door-knocking?${params.toString()}`
}

/**
 * The plan as one checklist: the next step first and largest, with the one
 * primary action and Skip; the other open steps as compact rows with Get
 * started; and the done steps checked at the bottom. A text checks itself
 * once it is sent; a call list or a walk checks itself once it is worked
 * through, and the official can tick or untick it by hand. A step's action
 * opens the standard flow for its channel on the list it drew, at the
 * message, with its civic panel invite drafting: texts and calls in place
 * over the page, doors on the door knocking page with the walkable area as
 * the boundary.
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
  const router = useRouter()
  const focusedStepId = useSearchParams()?.get('step') ?? null
  const sms = useServeSmsFlag(false)
  const [opened, setOpened] = useState<Opened | null>(null)
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

  const start = async (step: CivicPanelBuildStep) => {
    setPendingId(step.id)
    setError(null)
    try {
      const { data } = await clientRequest(
        'POST /v1/contacts/civic-panel/plan/steps/:id/prepare',
        { id: step.id },
      )
      if (data.channel === 'door_knocking') {
        router.push(doorFlowHref(data))
        return
      }
      const smsPurpose = SERVE_SMS_PURPOSE_VALUES.find(
        (purpose) => purpose === data.purpose,
      )
      const callPurpose = SERVE_PHONE_BANKING_PURPOSE_VALUES.find(
        (purpose) => purpose === data.purpose,
      )
      if (data.channel === 'text' && smsPurpose) {
        setOpened({
          channel: 'text',
          listId: data.voterFileFilterId,
          purpose: smsPurpose,
        })
      } else if (data.channel === 'phone_banking' && callPurpose) {
        setOpened({
          channel: 'phone_banking',
          listId: data.voterFileFilterId,
          purpose: callPurpose,
        })
      } else {
        fail(step.id, COPY.stepError)
      }
      setPendingId(null)
    } catch {
      fail(step.id, COPY.stepError)
      setPendingId(null)
    }
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

  const close = () => {
    setOpened(null)
    void refresh()
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
          className={cn(primary && 'flex-1 sm:flex-none')}
        >
          <Link href={keepGoing}>{COPY.keepGoing[step.channel]}</Link>
        </Button>
      )
    }
    if (step.status !== 'not_started') return null
    if (step.channel === 'text' && sms.ready && !sms.enabled) {
      return <p className="text-sm text-muted-foreground">{COPY.textingOff}</p>
    }
    return (
      <Button
        type="button"
        size={primary ? 'large' : 'medium'}
        variant={primary ? 'default' : 'outline'}
        className={cn(primary && 'flex-1 sm:flex-none')}
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
        {rest.map((step) => (
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
                <p className="text-base font-semibold text-foreground">
                  {stepTitle(step)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {stepDetail(step)}
                </p>
              </div>
              <div className="shrink-0">{actionFor(step, false)}</div>
            </div>
            {errorFor(step)}
          </li>
        ))}
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
      {opened?.channel === 'text' && sms.ready && sms.enabled ? (
        <SmsFlow
          open
          onClose={close}
          onScheduled={refresh}
          surface={SERVE_SMS_SURFACE}
          initialPurpose={opened.purpose}
          preselectedListId={opened.listId}
          audienceSettled
          source="deep_link"
        />
      ) : null}
      {opened?.channel === 'phone_banking' ? (
        <PhoneBankingFlow
          open
          onClose={close}
          onSaved={() => void refresh()}
          surface={SERVE_PHONE_BANKING_SURFACE}
          preselectedListId={opened.listId}
          initialPurpose={opened.purpose}
          initialName={COPY.callListName}
          source="deep_link"
        />
      ) : null}
    </section>
  )
}
