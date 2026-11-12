'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import type { EmailDraft } from '@goodparty_org/contracts'
import { useServeImportContactsFlag } from 'app/shared/experiments/serveImportContactsFlag'
import { useContactUploads } from 'app/dashboard/contacts/crm/import/importContactsApi'
import { getImportContactsCopy } from 'app/dashboard/contacts/crm/import/importContactsCopy'
import { useImportContactsSteps } from 'app/dashboard/contacts/crm/import/useImportContactsSteps'
import { MAX_SEGMENT_NAME_LENGTH } from 'app/dashboard/contacts/crm/shared/segments.util'
import { Alert, AlertDescription, toast } from '@styleguide'
import { CircleAlertIcon } from '@styleguide/components/ui/icons'
import { OutreachFlowShell, type FlowShellCta } from '../OutreachFlowShell'
import { ChannelBadge } from '../channelMeta'
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
  useEmailAudienceCounts,
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
import { emailImportStatus } from './emailImportStatus'

// Count-only, like robocall's landline overlay: the builder counts people
// with an email address, and the saved list stays general.
const EMAIL_COUNT_OVERLAY = { hasEmail: true }
const EVERYONE_COUNT = { everyone: true, listIds: [] }
// Asks for no count, so gp-api answers from Postgres alone: whether any
// imported contact has an email address.
const ANYONE_WITH_EMAIL = { everyone: false, listIds: [] }

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
  const [writePresses, setWritePresses] = useState(0)
  const [lookAttempted, setLookAttempted] = useState(false)
  const [draftId, setDraftId] = useState<number | null>(draft?.id ?? null)
  const draftListId = loaded?.listId ?? null
  const audience = useOutreachAudience({
    open,
    active: step === 'audience',
    reachabilityKey: 'email',
    countOverlay: EMAIL_COUNT_OVERLAY,
    preselectedListId: draftListId ?? undefined,
    countUniverse: false,
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
  // What Exit compares against the last save. A list the check found gone
  // is not an edit, so it still counts as the draft's own.
  const keyListId = audience.selectedListId ?? draftListId
  // With no list picked, everyone with an email is the audience. Continue
  // saves it as the whole-constituency list, as picking that row does.
  const everyoneDefault = listId === null && audience.universeName !== null
  // Continue waits on the quick check alone, never on the warehouse count,
  // which can be slow or fail; if the check itself fails, Continue stays on.
  // gp-api counts again at review and confirm, and confirm refuses a send
  // that reaches no one.
  const anyoneQuery = useEmailAudienceCounts(
    surface.isServe,
    ANYONE_WITH_EMAIL,
    open && step === 'audience',
  )
  const anyoneWithEmail = anyoneQuery.isError
    ? true
    : (anyoneQuery.data?.anyoneWithEmail ?? null)
  const everyoneQuery = useEmailAudienceCounts(
    surface.isServe,
    EVERYONE_COUNT,
    open && step === 'audience',
  )
  const noOneWithEmail = anyoneWithEmail === false
  const everyone = {
    count: noOneWithEmail ? 0 : (everyoneQuery.data?.everyone ?? null),
    loading: !noOneWithEmail && everyoneQuery.isFetching,
    failed:
      !noOneWithEmail &&
      !everyoneQuery.isFetching &&
      (everyoneQuery.isError || everyoneQuery.data?.everyone === null),
  }
  // Upload contacts on the audience step opens the import's steps here, in
  // place of the audience; once the file is up the list builder opens with
  // that import picked and its name as the list's, while it is matched.
  const { enabled: importOn } = useServeImportContactsFlag(false)
  const [uploading, setUploading] = useState(false)
  const [flowUploadId, setFlowUploadId] = useState<string | null>(null)
  const importSteps = useImportContactsSteps({
    open: open && uploading,
    isWin: !surface.isServe,
    onUploaded: (created) => {
      setFlowUploadId(created.id)
      setUploading(false)
      audience.resetBuilder()
      audience.setBuilderContactUploadIds([created.id])
      audience.setBuilderName(created.name.slice(0, MAX_SEGMENT_NAME_LENGTH))
      audience.startBuilder()
      // Saved now, with nothing written yet, so leaving at any point after
      // this keeps the draft. A failed save leaves the first save to the
      // look step, as without an import.
      void save(undefined, listId)
    },
  })
  const uploadsQuery = useContactUploads(open && importOn)
  const importStatus = emailImportStatus(
    uploadsQuery.data?.uploads ?? [],
    flowUploadId,
    surface,
    step === 'review',
  )
  // The count, cap and price read while the import ran are stale once it is
  // done, so everything this flow counted is read again.
  const wasImporting = useRef(false)
  useEffect(() => {
    if (wasImporting.current && !importStatus.importing) {
      void queryClient.invalidateQueries({
        queryKey: ['outreach', surface.isServe ? 'serve-email' : 'email'],
      })
      void queryClient.invalidateQueries({
        queryKey: ['outreach-audience-reachability'],
      })
      void queryClient.invalidateQueries({ queryKey: ['list-wizard-count'] })
    }
    wasImporting.current = importStatus.importing
  }, [importStatus.importing, queryClient, surface.isServe])
  // The builder counts the people this flow's import has added so far, so
  // the count is read again as more are added.
  const flowUploadAdded =
    uploadsQuery.data?.uploads.find((upload) => upload.id === flowUploadId)
      ?.progress?.added ?? null
  useEffect(() => {
    if (flowUploadAdded === null) return
    void queryClient.invalidateQueries({ queryKey: ['list-wizard-count'] })
  }, [flowUploadAdded, queryClient])
  const [sendDate, setSendDate] = useState(() => loaded?.sendDate ?? new Date())
  const [timeSlot, setTimeSlot] = useState(loaded?.timeSlot ?? SEND_NOW_SLOT)
  const [customTime, setCustomTime] = useState(loaded?.customTime ?? '')
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // What the last successful save sent, so Exit can tell a saved draft from
  // one with edits made since.
  const [savedKey, setSavedKey] = useState<string | null>(null)
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

  // `list` is for a list just picked, before the selection has rendered.
  const save = async (
    date: string | undefined,
    list: number | null = listId,
  ): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      const draft = await saveEmailDraft(
        surface.isServe,
        toDraftSave(goalText, compose, draftId, date, list),
      )
      setDraftId(draft.id)
      setSavedKey(
        JSON.stringify(
          toDraftSave(goalText, compose, null, date, list ?? keyListId),
        ),
      )
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
      ? "As soon as it's paid"
      : new Date(schedule.iso).toLocaleString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        })

  const currentKey = JSON.stringify(
    toDraftSave(
      goalText,
      compose,
      null,
      schedule.ok ? schedule.iso : 'unscheduled',
      keyListId,
    ),
  )
  // A reopened draft starts out saved as loaded.
  useEffect(() => {
    if (draft) setSavedKey(currentKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const unsaved = draftId === null || savedKey !== currentKey

  const next = async () => {
    if (step === 'goal') return goTo('audience')
    // The draft needs its content, so the first save is on leaving the look
    // step, with the list picked before it, unless an upload in the flow
    // saved it already.
    if (step === 'audience') return goTo('write')
    if (step === 'write') {
      setWriteAttempted(true)
      setWritePresses((n) => n + 1)
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
            label: 'Continue',
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
            loading: audience.builderCounting,
            disabled:
              audience.builderCounting ||
              audience.builderZeroMatch ||
              audience.builderCapError,
          }
        : audience.mode === 'name'
          ? {
              label: 'Continue',
              onClick: () => {
                // A failure shows as createListError under the builder.
                audience
                  .createList()
                  .then(() => goTo('write'))
                  .catch(() => undefined)
              },
              disabled: audience.builderName.trim().length === 0,
              loading: audience.createListPending,
            }
          : everyoneDefault
            ? {
                label:
                  everyone.count !== null && !everyone.loading
                    ? `Continue (${everyone.count.toLocaleString()})`
                    : 'Continue',
                onClick: () => {
                  // A failure shows under the picker.
                  void audience.selectUniverse().then((id) => {
                    if (id === null) return
                    audience.onSelect(id)
                    goTo('write')
                  })
                },
                loading: audience.universePending,
                disabled:
                  audience.listsLoading ||
                  anyoneWithEmail !== true ||
                  everyone.count === 0,
              }
            : {
                label:
                  audience.reachableCount !== null
                    ? `Continue (${audience.reachableCount.toLocaleString()})`
                    : 'Continue',
                onClick: () => void next(),
                loading: busy,
                disabled:
                  audience.selectedList === null ||
                  audience.reachableLoading ||
                  !audience.reachableCount,
              },
    write: {
      label: 'Continue',
      onClick: () => void next(),
    },
    look: {
      label: 'Continue',
      onClick: () => void next(),
      loading: busy,
    },
    schedule: {
      label: 'Continue',
      onClick: () => void next(),
      loading: busy,
    },
    review: {
      label: 'Continue to payment',
      onClick: () => void next(),
      disabled: importStatus.importing,
    },
    pay: null,
  }

  const stepTitles: Record<EmailStep, string> = {
    goal: surface.goal.title,
    audience: surface.audience.picker.pickerTitle,
    write: surface.compose.title,
    look: surface.look.title,
    schedule: surface.schedule.title,
    review: surface.review.title,
    pay: 'How do you want to pay?',
  }
  const importCopy = getImportContactsCopy(!surface.isServe)

  const body =
    paid && draftId !== null ? (
      <EmailStatus
        surface={surface}
        id={draftId}
        sendLabel={sendLabel}
        justPaid
        sendNow={!schedule.ok || schedule.iso === undefined}
      />
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
        {step === 'audience' && uploading && importSteps.body}
        {step === 'audience' && !uploading && (
          <EmailAudienceStep
            surface={surface}
            audience={audience}
            everyone={everyone}
            everyoneDefault={everyoneDefault}
            onUploadContacts={importOn ? () => setUploading(true) : undefined}
          />
        )}
        {step === 'write' && (
          <EmailWriteStep
            surface={surface}
            value={compose}
            onChange={setCompose}
            showIssues={writeAttempted}
            continuePresses={writePresses}
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
            audienceName={audience.selectedList?.name ?? null}
            onFixBlock={fixBlock}
          />
        )}
        {step === 'pay' && draftId !== null && (
          <EmailPayStep
            surface={surface}
            draftId={draftId}
            scheduled={schedule.ok && schedule.iso !== undefined}
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

  // A saved draft waits in the history, so leaving says so instead of
  // warning that it will be lost.
  const close = () => {
    if (uploading) {
      if (importSteps.isSending) return
      importSteps.trackAbandoned()
    }
    if (!paid && draftId !== null && !unsaved) toast('Draft saved')
    onClose()
  }

  return (
    <OutreachFlowShell
      open={open}
      onClose={close}
      title={
        paid ? 'Email' : uploading ? importCopy.wizard.title : stepTitles[step]
      }
      headerBadge={<ChannelBadge type="email" />}
      currentStep={paid ? 0 : index + 1}
      totalSteps={paid ? 0 : STEP_ORDER.length}
      onBack={
        uploading
          ? importSteps.isSending
            ? undefined
            : (importSteps.back ??
              (() => {
                importSteps.trackAbandoned()
                setUploading(false)
              }))
          : paid ||
              busy ||
              confirmTried ||
              index === 0 ||
              audience.createListPending
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
      cta={
        paid
          ? { label: 'Done', onClick: onClose }
          : uploading
            ? importSteps.cta
            : ctaByStep[step]
      }
      banner={
        !paid && !uploading && importStatus.line ? (
          <p
            className="w-full text-sm text-muted-foreground"
            role="status"
            data-testid="email-import-status"
          >
            {importStatus.line}
            {importStatus.link && (
              <>
                {' '}
                {/* A new tab, so the flow stays where it is. */}
                <Link
                  href={importStatus.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary underline underline-offset-4"
                >
                  {importStatus.link.text}
                </Link>
              </>
            )}
            {importStatus.after &&
              (/^[.,]/.test(importStatus.after)
                ? importStatus.after
                : ` ${importStatus.after}`)}
          </p>
        ) : undefined
      }
      dirty={
        (!paid && goalId !== null && unsaved) ||
        (uploading && importSteps.dirty)
      }
    >
      {body}
    </OutreachFlowShell>
  )
}
