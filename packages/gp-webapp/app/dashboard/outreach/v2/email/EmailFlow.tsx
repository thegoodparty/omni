'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { EmailRecipientUploadResponse } from '@goodparty_org/contracts'
import { Alert, AlertDescription } from '@styleguide'
import { CircleAlertIcon } from '@styleguide/components/ui/icons'
import { OutreachFlowShell, type FlowShellCta } from '../OutreachFlowShell'
import { EmailAudienceStep } from './EmailAudienceStep'
import { EmailComposeStep } from './EmailComposeStep'
import { EmailGoalStep } from './EmailGoalStep'
import { EmailPayStep } from './EmailPayStep'
import { EmailReviewStep } from './EmailReviewStep'
import { EmailScheduleStep } from './EmailScheduleStep'
import { EmailStatus } from './EmailStatus'
import {
  apiErrorMessage,
  emailSendQueryKey,
  saveEmailDraft,
  useEmailSender,
} from './emailApi'
import {
  checkSchedule,
  composeIssues,
  initialCompose,
  toDraftSave,
  type EmailComposeState,
} from './emailFlow.util'
import { WIN_EMAIL_SURFACE, type EmailSurface } from './emailSurface'

const STEP_ORDER = [
  'goal',
  'compose',
  'audience',
  'schedule',
  'review',
  'pay',
] as const
type EmailStep = (typeof STEP_ORDER)[number]

interface EmailFlowProps {
  open: boolean
  onClose: () => void
  surface?: EmailSurface
}

export const EmailFlow = ({
  open,
  onClose,
  surface = WIN_EMAIL_SURFACE,
}: EmailFlowProps) => {
  const queryClient = useQueryClient()
  const { data: sender } = useEmailSender(surface.isServe)
  const [step, setStep] = useState<EmailStep>('goal')
  const [paid, setPaid] = useState(false)
  const [confirmTried, setConfirmTried] = useState(false)
  const [goalId, setGoalId] = useState<string | null>(null)
  const [customGoal, setCustomGoal] = useState('')
  const [compose, setCompose] = useState<EmailComposeState>(initialCompose)
  const [composeAttempted, setComposeAttempted] = useState(false)
  const [draftId, setDraftId] = useState<number | null>(null)
  const [upload, setUpload] = useState<EmailRecipientUploadResponse | null>(
    null,
  )
  const [sendNow, setSendNow] = useState(true)
  const [day, setDay] = useState('')
  const [time, setTime] = useState('10:00')
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const goalText =
    goalId === surface.customGoalId
      ? customGoal.trim()
      : (surface.goals.find((g) => g.id === goalId)?.label ?? '')
  const issues = composeIssues(compose)
  const composeValid = Object.keys(issues).length === 0
  const index = STEP_ORDER.indexOf(step)

  const goTo = (next: EmailStep) => {
    setError(null)
    setStep(next)
  }

  const save = async (date: string | undefined): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      const draft = await saveEmailDraft(
        surface.isServe,
        toDraftSave(goalText, compose, draftId, date),
      )
      setDraftId(draft.id)
      void queryClient.invalidateQueries({
        queryKey: emailSendQueryKey(surface.isServe, draft.id),
      })
      return true
    } catch (e) {
      setError(apiErrorMessage(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  const schedule = checkSchedule(sendNow, day, time)
  const sendLabel =
    sendNow || !schedule.ok || !schedule.iso
      ? 'As soon as it is paid'
      : new Date(schedule.iso).toLocaleString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        })

  const next = async () => {
    if (step === 'goal') return goTo('compose')
    if (step === 'compose') {
      setComposeAttempted(true)
      if (!composeValid) return
      if (await save(undefined)) goTo('audience')
      return
    }
    if (step === 'audience') return goTo('schedule')
    if (step === 'schedule') {
      const check = checkSchedule(sendNow, day, time)
      if (!check.ok) {
        setScheduleError(check.message)
        return
      }
      setScheduleError(null)
      if (await save(check.iso)) goTo('review')
      return
    }
    goTo('pay')
  }

  const ctaByStep: Record<EmailStep, FlowShellCta | null> = {
    goal:
      goalId === surface.customGoalId
        ? {
            label: 'Next',
            onClick: () => goTo('compose'),
            disabled: !customGoal.trim(),
          }
        : null,
    compose: {
      label: 'Next',
      onClick: () => void next(),
      loading: busy,
    },
    audience: {
      label: 'Next',
      onClick: () => void next(),
      disabled: !upload || upload.ready === 0,
    },
    schedule: {
      label: 'Next',
      onClick: () => void next(),
      loading: busy,
    },
    review: {
      label: 'Continue to payment',
      onClick: () => void next(),
    },
    pay: null,
  }

  const body =
    paid && draftId !== null ? (
      <EmailStatus surface={surface} id={draftId} />
    ) : (
      <div className="space-y-4">
        {step === 'goal' && (
          <EmailGoalStep
            surface={surface}
            goalId={goalId}
            customGoal={customGoal}
            onSelect={(id) => {
              setGoalId(id)
              if (id !== surface.customGoalId) goTo('compose')
            }}
            onCustomGoalChange={setCustomGoal}
          />
        )}
        {step === 'compose' && (
          <EmailComposeStep
            surface={surface}
            value={compose}
            onChange={setCompose}
            issues={issues}
            showIssues={composeAttempted}
            senderName={sender?.displayName ?? ''}
            goal={goalText}
          />
        )}
        {step === 'audience' && draftId !== null && (
          <EmailAudienceStep
            surface={surface}
            draftId={draftId}
            result={upload}
            onUploaded={(result) => {
              setUpload(result)
              void queryClient.invalidateQueries({
                queryKey: emailSendQueryKey(surface.isServe, draftId),
              })
            }}
          />
        )}
        {step === 'schedule' && (
          <EmailScheduleStep
            surface={surface}
            sendNow={sendNow}
            day={day}
            time={time}
            error={scheduleError}
            onSendNowChange={setSendNow}
            onDayChange={setDay}
            onTimeChange={setTime}
          />
        )}
        {step === 'review' && upload && (
          <EmailReviewStep
            surface={surface}
            compose={compose}
            result={upload}
            draftId={draftId}
            sendLabel={sendLabel}
          />
        )}
        {step === 'pay' && draftId !== null && (
          <EmailPayStep
            surface={surface}
            draftId={draftId}
            onPaid={() => setPaid(true)}
            onConfirmAttempted={() => setConfirmTried(true)}
          />
        )}
        {error && (
          <Alert variant="destructive" icon={<CircleAlertIcon />}>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    )

  return (
    <OutreachFlowShell
      open={open}
      onClose={onClose}
      title="Email"
      headerBadge="Email"
      currentStep={paid ? 0 : index + 1}
      totalSteps={paid ? 0 : STEP_ORDER.length}
      onBack={
        paid || busy || confirmTried || index === 0
          ? undefined
          : () => goTo(STEP_ORDER[index - 1]!)
      }
      cta={paid ? { label: 'Done', onClick: onClose } : ctaByStep[step]}
      dirty={!paid && goalId !== null}
    >
      {body}
    </OutreachFlowShell>
  )
}
