import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { format } from 'date-fns'
import {
  SERVE_PHONE_BANKING_PURPOSE_VALUES,
  SERVE_SMS_PURPOSE_VALUES,
  type CivicPanelBuildNext,
  type CivicPanelBuildPlan,
  type CivicPanelBuildPlanResponse,
  type CivicPanelBuildStep,
} from '@goodparty_org/contracts'
import { Badge, Button, cn } from '@styleguide'
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

const STATUS_CHIP: Record<CivicPanelBuildStep['status'], string> = {
  not_started: 'bg-muted text-muted-foreground border-border',
  in_progress: 'bg-primary/10 text-primary border-primary/30',
  waiting_on_replies: 'bg-primary/10 text-primary border-primary/30',
  done: 'bg-success/10 text-success border-success/30',
  skipped: 'bg-muted text-muted-foreground border-border',
}

const stepTitle = (step: CivicPanelBuildStep): string => {
  const size = numberFormatter(step.targetSize)
  return step.channel === 'door_knocking'
    ? COPY.stepTitle.door_knocking(size, step.position)
    : COPY.stepTitle[step.channel](size)
}

const statusLabel = (step: CivicPanelBuildStep): string =>
  step.status === 'waiting_on_replies'
    ? COPY.stepStatus.waiting_on_replies(
        step.expectedRepliesBy
          ? format(new Date(step.expectedRepliesBy), 'MMMM d')
          : null,
      )
    : COPY.stepStatus[step.status]

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

/**
 * The plan's steps, the current wave first. A step nobody started opens the
 * standard flow for its channel on the list it drew: texts and calls in
 * place over the page, doors on the door knocking page.
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
        router.push(
          `/dashboard/door-knocking?create=1&listId=${data.voterFileFilterId}`,
        )
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

  const close = () => {
    setOpened(null)
    void refresh()
  }

  const current = plan.steps.filter((s) => s.wave === plan.currentWave)
  const earlier = plan.steps.filter((s) => s.wave < plan.currentWave)

  const row = (step: CivicPanelBuildStep) => {
    const keepGoing = keepGoingHref(step)
    const ready = step.status === 'not_started'
    const textingOff = step.channel === 'text' && sms.ready && !sms.enabled
    const primary = next?.stepId === step.id
    return (
      <li
        key={step.id}
        id={`panel-step-${step.id}`}
        data-focused={focusedStepId === step.id}
        className={cn(
          'flex flex-col gap-2 px-4 py-3',
          focusedStepId === step.id && 'rounded-lg ring-2 ring-primary',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <p
            className={cn(
              'text-sm font-medium text-foreground',
              step.status === 'skipped' && 'text-muted-foreground',
            )}
          >
            {stepTitle(step)}
          </p>
          <Badge
            variant="outline"
            className={cn('shrink-0 text-xs', STATUS_CHIP[step.status])}
          >
            {statusLabel(step)}
          </Badge>
        </div>
        {ready && textingOff ? (
          <p className="text-xs text-muted-foreground">{COPY.textingOff}</p>
        ) : null}
        {ready && !textingOff ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="small"
              variant={primary ? 'default' : 'outline'}
              loading={pendingId === step.id}
              disabled={pendingId !== null && pendingId !== step.id}
              onClick={() => void start(step)}
            >
              {COPY.startStep[step.channel]}
            </Button>
            <Button
              type="button"
              size="small"
              variant="ghost"
              disabled={pendingId !== null}
              onClick={() => void skip(step)}
            >
              {COPY.skipStep}
            </Button>
          </div>
        ) : null}
        {keepGoing && step.channel !== 'text' ? (
          <Button
            asChild
            size="small"
            variant={primary ? 'default' : 'outline'}
            className="self-start"
          >
            <Link href={keepGoing}>{COPY.keepGoing[step.channel]}</Link>
          </Button>
        ) : null}
        {error?.stepId === step.id ? (
          <p className="text-xs text-destructive" role="alert">
            {error.message}
          </p>
        ) : null}
      </li>
    )
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-background py-4">
      <div className="px-5">
        <h2 className="text-base font-semibold text-foreground">
          {COPY.planTitle}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {COPY.planCaption}
        </p>
      </div>
      <div className="flex flex-col gap-1 px-1">
        <p className="px-4 text-xs font-medium text-muted-foreground">
          {COPY.currentWave}
        </p>
        <ul className="divide-y divide-border">{current.map(row)}</ul>
      </div>
      {earlier.length > 0 ? (
        <div className="flex flex-col gap-1 px-1">
          <p className="px-4 text-xs font-medium text-muted-foreground">
            {COPY.earlierWaves}
          </p>
          <ul className="divide-y divide-border">{earlier.map(row)}</ul>
        </div>
      ) : null}
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
