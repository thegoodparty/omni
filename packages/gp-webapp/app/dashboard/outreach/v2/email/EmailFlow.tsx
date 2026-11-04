'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { EmailDraft } from '@goodparty_org/contracts'
import { Alert, AlertDescription } from '@styleguide'
import { CircleAlertIcon } from '@styleguide/components/ui/icons'
import { OutreachFlowShell, type FlowShellCta } from '../OutreachFlowShell'
import { useOutreachAudience } from '../audience/useOutreachAudience'
import { EmailAudienceStep } from './EmailAudienceStep'
import { EmailGoalStep } from './EmailGoalStep'
import { EmailLookStep } from './EmailLookStep'
import { EmailPayStep } from './EmailPayStep'
import { EmailReviewStep } from './EmailReviewStep'
import { EmailScheduleStep } from './EmailScheduleStep'
import { EmailStatus } from './EmailStatus'
import { EmailWriteStep } from './EmailWriteStep'
import {
  apiErrorMessage,
  emailSendQueryKey,
  saveEmailDraft,
  useEmailSender,
} from './emailApi'
import {
  checkScheduleSlot,
  EMAIL_STEP_ORDER as STEP_ORDER,
  loadEmailDraft,
  SEND_NOW_SLOT,
  toDraftSave,
  type EmailStep,
} from './emailFlow.util'
import {
  composeIssues,
  hasIssues,
  initialCompose,
  lookStepIssue,
  serverFieldError,
  writeStepIssues,
  type ComposeFieldError,
  type EmailComposeState,
} from './emailForm.util'
import { WIN_EMAIL_SURFACE, type EmailSurface } from './emailSurface'

// Count-only, like robocall's landline overlay: the builder counts people
// with an email address, and the saved list stays general.
const EMAIL_COUNT_OVERLAY = { hasEmail: true }

interface EmailFlowProps {
  open: boolean
  onClose: () => void
  surface?: EmailSurface
  // A saved draft to pick back up. Read once, on mount.
  draft?: EmailDraft
}

export const EmailFlow = ({
  open,
  onClose,
  surface = WIN_EMAIL_SURFACE,
  draft,
}: EmailFlowProps) => {
  const queryClient = useQueryClient()
  useEmailSender(surface.isServe)
  const [loaded] = useState(() =>
    draft ? loadEmailDraft(draft, surface) : null,
  )
  const [step, setStep] = useState<EmailStep>(loaded?.step ?? 'goal')
  const [paid, setPaid] = useState(false)
  const [confirmTried, setConfirmTried] = useState(false)
  const [goalId, setGoalId] = useState<string | null>(loaded?.goalId ?? null)
  const [customGoal, setCustomGoal] = useState(loaded?.customGoal ?? '')
  const [compose, setComposeState] = useState<EmailComposeState>(
    () => loaded?.compose ?? initialCompose(),
  )
  const [fieldError, setFieldError] = useState<ComposeFieldError | null>(null)
  const setCompose = (
    next: EmailComposeState | ((prev: EmailComposeState) => EmailComposeState),
  ) => {
    setFieldError(null)
    setComposeState(next)
  }
  const [writeAttempted, setWriteAttempted] = useState(false)
  const [lookAttempted, setLookAttempted] = useState(false)
  const [draftId, setDraftId] = useState<number | null>(draft?.id ?? null)
  const draftListId = loaded?.listId ?? null
  const audience = useOutreachAudience({
    open,
    active: step === 'audience',
    reachabilityKey: 'email',
    countOverlay: EMAIL_COUNT_OVERLAY,
    preselectedListId: draftListId ?? undefined,
  })
  // Until the saved lists load, the draft's list can't be picked yet, so a
  // save keeps it. Once they load, a list that is gone sends the flow back
  // to the audience step.
  const [listChecked, setListChecked] = useState(draftListId === null)
  const listsSettled = !audience.listsLoading && !audience.listsFetching
  const draftListGone =
    listsSettled && !audience.lists.some((l) => l.id === draftListId)
  useEffect(() => {
    if (listChecked || !listsSettled) return
    setListChecked(true)
    if (
      draftListGone &&
      STEP_ORDER.indexOf(step) > STEP_ORDER.indexOf('audience')
    ) {
      setStep('audience')
    }
  }, [listChecked, listsSettled, draftListGone, step])
  const listId = audience.selectedListId ?? (listChecked ? null : draftListId)
  const [sendDate, setSendDate] = useState(() => loaded?.sendDate ?? new Date())
  const [timeSlot, setTimeSlot] = useState(loaded?.timeSlot ?? SEND_NOW_SLOT)
  const [customTime, setCustomTime] = useState(loaded?.customTime ?? '')
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const goalText =
    goalId === surface.customGoalId
      ? customGoal.trim()
      : (surface.goals.find((g) => g.id === goalId)?.label ?? '')
  const finalIssues = composeIssues(compose, true)
  const composeValid = !hasIssues(finalIssues)
  const writeValid = !hasIssues(writeStepIssues(compose, true))
  const lookBlocked = lookStepIssue(compose) !== undefined
  const index = STEP_ORDER.indexOf(step)

  const goTo = (next: EmailStep) => {
    setError(null)
    setStep(next)
  }

  // Confirm and the test send name the block they refuse; the fix is on
  // the form field that block came from, on the step that shows it.
  const fixBlock = (message: string): boolean => {
    const parsed = serverFieldError(compose, message)
    if (!parsed) return false
    setWriteAttempted(true)
    setLookAttempted(true)
    goTo(parsed.field === 'button' ? 'look' : 'write')
    setFieldError(parsed)
    return true
  }

  const save = async (date: string | undefined): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      const draft = await saveEmailDraft(
        surface.isServe,
        toDraftSave(goalText, compose, draftId, date, listId),
      )
      setDraftId(draft.id)
      void queryClient.invalidateQueries({
        queryKey: emailSendQueryKey(surface.isServe, draft.id),
      })
      return true
    } catch (e) {
      const message = apiErrorMessage(e)
      if (!fixBlock(message)) setError(message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const schedule = checkScheduleSlot(sendDate, timeSlot, customTime)
  const sendLabel =
    !schedule.ok || !schedule.iso
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
    if (step === 'goal') return goTo('audience')
    // The draft needs its content, so the first save is on leaving the look
    // step, with the list picked before it.
    if (step === 'audience') return goTo('write')
    if (step === 'write') {
      setWriteAttempted(true)
      if (writeValid) goTo('look')
      return
    }
    if (step === 'look') {
      setLookAttempted(true)
      if (!composeValid || lookBlocked) return
      if (await save(undefined)) goTo('schedule')
      return
    }
    if (step === 'schedule') {
      const check = checkScheduleSlot(sendDate, timeSlot, customTime)
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
            onClick: () => goTo('audience'),
            disabled: !customGoal.trim(),
          }
        : null,
    audience:
      audience.mode === 'filters'
        ? {
            label: audience.builderCounting
              ? 'Continue'
              : `Continue (${(audience.builderCount ?? 0).toLocaleString()})`,
            onClick: () => audience.setMode('name'),
            disabled:
              audience.builderCounting ||
              audience.builderZeroMatch ||
              audience.builderCapError,
          }
        : audience.mode === 'name'
          ? {
              label: 'Create list',
              onClick: () => {
                // A failure shows as createListError under the builder.
                audience.createList().catch(() => undefined)
              },
              disabled: audience.builderName.trim().length === 0,
              loading: audience.createListPending,
            }
          : {
              label: 'Next',
              onClick: () => void next(),
              loading: busy,
              disabled:
                audience.selectedList === null ||
                audience.reachableLoading ||
                !audience.reachableCount,
            },
    write: {
      label: 'Next',
      onClick: () => void next(),
    },
    look: {
      label: 'Next',
      onClick: () => void next(),
      loading: busy,
      disabled: lookBlocked,
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
              if (id !== surface.customGoalId) goTo('audience')
            }}
            onCustomGoalChange={setCustomGoal}
          />
        )}
        {step === 'audience' && (
          <EmailAudienceStep surface={surface} audience={audience} />
        )}
        {step === 'write' && (
          <EmailWriteStep
            surface={surface}
            value={compose}
            onChange={setCompose}
            showIssues={writeAttempted}
            goal={goalText}
            serverError={fieldError}
          />
        )}
        {step === 'look' && (
          <EmailLookStep
            surface={surface}
            value={compose}
            onChange={setCompose}
            showIssues={lookAttempted}
            serverError={fieldError}
          />
        )}
        {step === 'schedule' && (
          <EmailScheduleStep
            surface={surface}
            date={sendDate}
            timeSlot={timeSlot}
            customTime={customTime}
            error={scheduleError}
            onDateChange={setSendDate}
            onTimeSlotChange={setTimeSlot}
            onCustomTimeChange={setCustomTime}
          />
        )}
        {step === 'review' && (
          <EmailReviewStep
            surface={surface}
            compose={compose}
            draftId={draftId}
            sendLabel={sendLabel}
            onFixBlock={fixBlock}
          />
        )}
        {step === 'pay' && draftId !== null && (
          <EmailPayStep
            surface={surface}
            draftId={draftId}
            onPaid={() => setPaid(true)}
            onConfirmAttempted={() => setConfirmTried(true)}
            onFixBlock={fixBlock}
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
          : () => {
              // In the list builder, Back walks name -> filters -> picker.
              if (step === 'audience' && audience.mode === 'name') {
                audience.clearCreateError()
                audience.setMode('filters')
                return
              }
              if (step === 'audience' && audience.mode === 'filters') {
                audience.resetBuilder()
                return
              }
              goTo(STEP_ORDER[index - 1]!)
            }
      }
      cta={paid ? { label: 'Done', onClick: onClose } : ctaByStep[step]}
      dirty={!paid && goalId !== null}
    >
      {body}
    </OutreachFlowShell>
  )
}
