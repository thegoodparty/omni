'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  type RobocallAuthorizeResponse,
  type RobocallComplianceRequest,
  type RobocallScriptDraftRequest,
  type SocialTone,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { OutreachFlowShell, type FlowShellCta } from '../OutreachFlowShell'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import { OUTREACH_OPTIONS } from 'app/dashboard/outreach/components/OutreachCreateCards'
import { hasAnyVoterFileSelection } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import { type RobocallPurpose } from '../robocallPurposes'
import {
  OutreachAudienceStep,
  type OutreachAudienceCopy,
} from '../audience/OutreachAudienceStep'
import { useOutreachAudience } from '../audience/useOutreachAudience'
import { useCampaign } from '@shared/hooks/useCampaign'
import { RobocallPurposeStep } from './RobocallPurposeStep'
import { RobocallScheduleStep } from './RobocallScheduleStep'
import { RobocallComposeStep } from './RobocallComposeStep'
import { RobocallReviewStep } from './RobocallReviewStep'
import { RobocallPayStep } from './RobocallPayStep'
import { useRobocallRecorder } from './useRobocallRecorder'
import { useRobocallAudioUpload } from './useRobocallAudioUpload'
import { combineScheduledAt, resolveCampaignTimeZone } from './scheduleTimeZone'

// The full flow: pick a purpose, pick/build the audience, choose when it goes
// out, record/compose the message, review the pre-send summary, then pay
// (create the draft, vault the card, authorize the hold).
type StepId = 'purpose' | 'audience' | 'schedule' | 'compose' | 'review' | 'pay'
const STEP_ORDER: StepId[] = [
  'purpose',
  'audience',
  'schedule',
  'compose',
  'review',
  'pay',
]

const STEP_TITLES: Record<StepId, string> = {
  purpose: 'What do you want to do?',
  audience: 'Who are you calling?',
  schedule: 'When should it go out?',
  compose: 'What do you want to say?',
  review: 'Review your campaign',
  pay: 'Payment',
}

// Hard 48h lead time (the compliance floor the design enforces). No upper
// bound here — the payment-window ceiling is a pay-step concern.
const MIN_LEAD_HOURS = 48
const MIN_LEAD_MS = MIN_LEAD_HOURS * 60 * 60 * 1000
// The recorded message caps at 60 seconds (one connected 60s CallHub billing
// unit); enforced in the recorder and on upload.
const MAX_RECORDING_SECONDS = 60

// Robocall dials landlines, so the reachable count and the in-flow builder
// count both use the landline dimension: reachability.robocall for a saved
// list, and a { hasLandline: true } overlay on the builder count. The overlay
// is count-only — the saved list itself stays general (see useOutreachAudience).
const ROBOCALL_AUDIENCE_COPY: OutreachAudienceCopy = {
  pickerTitle: 'Who are you calling?',
  pickerBody:
    'We recommend reaching all your supporters to increase awareness.',
  filtersTitle: 'Build a voter list',
  filtersBody: 'Pick filters to define who this campaign reaches.',
  nameTitle: 'Name your list',
  nameBody: 'You can rename it any time.',
  reachVerb: 'Reach',
  reachNoun: 'supporters with landlines',
  unitCostLabel: 'Each call costs',
}

const PRICE_PER_CONTACT =
  OUTREACH_OPTIONS.find((o) => o.type === OUTREACH_TYPES.robocall)?.cost ??
  0.045

// Stable identity: the landline overlay for the builder count (see
// useOutreachAudience — count-only, never written into the saved list).
const ROBOCALL_COUNT_OVERLAY = { hasLandline: true }

interface RobocallFlowProps {
  open: boolean
  onClose: () => void
}

// Flow state is flat client state owned here (phase 1 TDD pattern): no server
// drafts, reopening starts fresh. Mirrors SocialFlow.
export const RobocallFlow = ({ open, onClose }: RobocallFlowProps) => {
  const [stepId, setStepId] = useState<StepId>('purpose')
  const [purpose, setPurpose] = useState<RobocallPurpose | null>(null)
  const [campaignName, setCampaignName] = useState('')
  const [scheduledDay, setScheduledDay] = useState<Date | undefined>(undefined)
  const [time, setTime] = useState('')
  // Re-pinned on entry to the schedule step (see goToSchedule) so the lead-time
  // floor is measured from when the user reaches it, then held stable while they
  // fill the step in rather than drifting on every re-render.
  const [now, setNow] = useState<Date>(() => new Date())
  // The last name we auto-filled; lets us refresh it when the list changes
  // without clobbering a name the user typed themselves.
  const lastAutoName = useRef('')

  const [campaign] = useCampaign()
  const timeZone = resolveCampaignTimeZone(campaign?.details?.state)

  const audience = useOutreachAudience({
    open,
    active: stepId === 'audience',
    reachabilityKey: 'robocall',
    countOverlay: ROBOCALL_COUNT_OVERLAY,
  })
  const { reset: resetAudience } = audience

  const [tone, setTone] = useState<SocialTone>('warm')
  const [script, setScript] = useState('')
  // Stale-response guard: a tone switch / regenerate bumps this, and a draft
  // response is discarded unless it's still the latest request.
  const draftRequestRef = useRef(0)
  // Latest purpose, read inside the rent onSuccess (which closes over the
  // render that started the rent) so a purpose change while renting doesn't
  // draft the old purpose — the fresh goToCompose drafts the new one instead.
  const purposeRef = useRef(purpose)
  purposeRef.current = purpose
  const recorder = useRobocallRecorder(MAX_RECORDING_SECONDS)
  const { reset: resetRecorder } = recorder
  const audioUpload = useRobocallAudioUpload()
  const { reset: resetAudioUpload } = audioUpload
  const isCustomPurpose = purpose === 'custom'

  // The fail-closed compliance gate: once a recording is uploaded, transcribe
  // it and verify the spoken disclosures. Continue is blocked until it passes.
  const complianceMutation = useMutation({
    mutationFn: async (input: RobocallComplianceRequest) => {
      const { data } = await clientRequest(
        'POST /v1/outreach/robocall/compliance',
        input,
      )
      return data
    },
  })
  const { mutate: runCompliance, reset: resetCompliance } = complianceMutation

  // Save commits the recording: upload it to S3 first, and only mark it saved
  // once the upload succeeds; the compliance check then runs off that saved
  // status (see the effect below).
  const handleSaveRecording = async () => {
    const rec = recorder.recording
    if (!rec) return
    const uploaded = await audioUpload.uploadAudio(rec.blob)
    if (uploaded) recorder.save()
  }

  // Re-recording (status back to idle) drops any prior upload + verdict.
  useEffect(() => {
    if (recorder.status === 'idle') {
      resetAudioUpload()
      resetCompliance()
    }
  }, [recorder.status, resetAudioUpload, resetCompliance])

  const draftMutation = useMutation({
    mutationFn: async (input: RobocallScriptDraftRequest) => {
      const { data } = await clientRequest(
        'POST /v1/outreach/robocall/draft',
        input,
      )
      return data.draft
    },
  })
  const { mutate: runDraft } = draftMutation

  // The rented CallHub caller-ID number the candidate reads aloud. Rented once
  // on entering compose so the draft can carry the required "paid for by" +
  // callback-number disclosure; held in flow state and reused across redrafts.
  const [callbackNumber, setCallbackNumber] = useState<string | null>(null)
  // The authorize outcome, held here (not in the pay step) so it survives Back
  // out of and back into the pay step — a settled outcome makes re-entry show
  // the result rather than re-opening the Authorize form.
  const [payOutcome, setPayOutcome] =
    useState<RobocallAuthorizeResponse | null>(null)
  const rentMutation = useMutation({
    mutationFn: async () => {
      const { data } = await clientRequest(
        'POST /v1/outreach/robocall/number',
        {},
      )
      return data.phoneNumber
    },
  })
  const { mutate: runRent, reset: resetRent } = rentMutation

  // Fire an AI script draft; a superseded response is discarded. Custom
  // purpose writes its own script, so it never drafts. A callbackNumber makes
  // the draft end with the spoken disclosure.
  const requestDraft = (
    p: RobocallPurpose,
    t: SocialTone,
    callback: string | null,
  ) => {
    if (p === 'custom') return
    const requestId = draftRequestRef.current + 1
    draftRequestRef.current = requestId
    runDraft(
      {
        purpose: p,
        tone: t,
        ...(callback ? { callbackNumber: callback } : {}),
      },
      {
        onSuccess: (draft) => {
          if (requestId === draftRequestRef.current) setScript(draft)
        },
        onError: () => {
          // Defensive: TanStack detaches the superseded observer on re-mutate,
          // so a stale request's error shouldn't reach isError today — but if
          // that ever changes, drop a superseded error so it can't show the
          // error card over a newer good draft.
          if (requestId !== draftRequestRef.current) draftMutation.reset()
        },
      },
    )
  }

  // Fresh flow every open — a cancelled-then-reopened flow must not resume.
  // The flow host stays mounted (open just toggles), so closing must actively
  // release the recorder: otherwise a mid-recording close leaves the mic live
  // until the 60s cap. Reset on close AND on open.
  useEffect(() => {
    if (!open) {
      resetRecorder()
      resetAudioUpload()
      return
    }
    setStepId('purpose')
    setPurpose(null)
    setCampaignName('')
    lastAutoName.current = ''
    setScheduledDay(undefined)
    setTime('')
    setNow(new Date())
    setTone('warm')
    setScript('')
    setCallbackNumber(null)
    setPayOutcome(null)
    resetRent()
    resetCompliance()
    draftRequestRef.current = 0
    resetRecorder()
    resetAudioUpload()
    resetAudience()
  }, [
    open,
    resetAudience,
    resetRecorder,
    resetAudioUpload,
    resetRent,
    resetCompliance,
  ])

  // Run the compliance check once a recording is saved (uploaded). Keyed on the
  // saved object key, so a fresh re-record re-checks and nothing else re-fires.
  // The check is an audio-content gate (name/org/callback derived or verified
  // server-side), so it needs only the recording — never the rented number.
  useEffect(() => {
    if (
      recorder.status === 'saved' &&
      audioUpload.key &&
      audioUpload.contentType
    ) {
      runCompliance({
        audioKey: audioUpload.key,
        contentType: audioUpload.contentType,
      })
    }
  }, [recorder.status, audioUpload.key, audioUpload.contentType, runCompliance])

  // Validate against the combined UTC instant so it's tz-correct: the send must
  // be at least 48h out. `earliest` (now + lead) drives both the "earliest
  // send" hint and the violation alert, mirroring the design's flowWhen.
  const scheduledAt = combineScheduledAt(scheduledDay, time, timeZone)
  const earliest = new Date(now.getTime() + MIN_LEAD_MS)
  const violatesLeadTime =
    scheduledAt !== null && scheduledAt.getTime() < earliest.getTime()
  const isScheduleValid = scheduledAt !== null && !violatesLeadTime

  const stepIndex = STEP_ORDER.indexOf(stepId)

  // Any change to the script the candidate must read aloud (purpose, tone,
  // regenerate) or backing out of compose invalidates a recording made against
  // the old script — drop it so a stale saved clip can't satisfy the Continue
  // gate against a script the candidate never read.
  const invalidateRecording = () => {
    resetRecorder()
    resetAudioUpload()
    resetCompliance()
  }

  // Re-run the check after a transient (transcription/LLM) failure, reusing the
  // already-uploaded recording.
  const retryCompliance = () => {
    if (audioUpload.key && audioUpload.contentType) {
      runCompliance({
        audioKey: audioUpload.key,
        contentType: audioUpload.contentType,
      })
    }
  }

  const handleSelectPurpose = (selected: RobocallPurpose) => {
    // Switching purpose invalidates the drafted script and any recording tied
    // to the old one — otherwise a custom script could show read-only under a
    // guided purpose (or vice-versa), and a stale saved clip would satisfy the
    // Continue gate.
    if (selected !== purpose) {
      setScript('')
      invalidateRecording()
      // Clear any prior draft error/success so it can't linger across the
      // switch — e.g. a failed guided draft leaving a stuck error card above
      // the custom textarea (custom never re-drafts to clear it).
      draftMutation.reset()
    }
    setPurpose(selected)
    setStepId('audience')
  }

  const handleBack = () => {
    // Within the builder, Back walks the sub-modes: name -> filters (keeps the
    // built filters), filters -> picker (resetBuilder clears them).
    if (stepId === 'audience' && audience.mode === 'name') {
      // Drop any failed-create error so it can't re-flash when the user
      // returns to the name step; keep the built filters.
      audience.clearCreateError()
      audience.setMode('filters')
      return
    }
    if (stepId === 'audience' && audience.mode === 'filters') {
      audience.resetBuilder()
      return
    }
    const previous = STEP_ORDER[stepIndex - 1]
    if (!previous) return
    // Backing OFF the audience step discards the picked list so a re-entry
    // starts from an empty picker instead of resuming a selection the user
    // just backed out of (which would leave Continue enabled on a stale list).
    // Backing INTO audience from a later step keeps the selection.
    if (stepId === 'audience') resetAudience()
    // Backing OFF compose drops the recording+upload for the same reason: a
    // saved clip must not silently keep Continue enabled after the user backs
    // out and re-advances (they re-record deliberately on return).
    if (stepId === 'compose') invalidateRecording()
    setStepId(previous)
  }

  const goToSchedule = () => {
    // Re-pin `now` on entry so the 48h floor is measured from when the user
    // actually reaches this step, not from flow-open (they may have spent a
    // while on earlier steps).
    setNow(new Date())
    // Auto-fill the campaign name from the chosen list (the design auto-fills
    // it). Refresh it when the list changes as long as the user hasn't edited
    // it (tracked via lastAutoName), so the name can't silently mismatch the
    // selected list; a hand-typed name is never clobbered.
    const listName = audience.selectedList?.name
    // Clamp to the name field's own maxLength (60): setCampaignName bypasses the
    // input's limit, so a long list name would otherwise auto-fill over-length.
    const auto = (
      listName ? `${listName} robocall` : 'Robocall campaign'
    ).slice(0, 60)
    if (campaignName.trim() === '' || campaignName === lastAutoName.current) {
      setCampaignName(auto)
      lastAutoName.current = auto
    }
    setStepId('schedule')
  }

  const handleCreateListContinue = async () => {
    try {
      await audience.createList()
      goToSchedule()
    } catch {
      // createListError renders the inline message below the step.
    }
  }

  // First AI draft on entry (non-custom, and only if we don't already have one
  // from a prior visit). Custom writes its own words, so it never drafts — but
  // it still needs the rented number to read aloud, shown in the compose step.
  const draftIfNeeded = (callback: string | null) => {
    if (purpose && purpose !== 'custom' && !script.trim()) {
      requestDraft(purpose, tone, callback)
    }
  }

  const rentCallbackNumber = () => {
    // Don't fire a second billable rent while one is in flight (Back to
    // schedule then Continue again before the first resolves).
    if (rentMutation.isPending) return
    const rentedForPurpose = purpose
    runRent(undefined, {
      onSuccess: (number) => {
        setCallbackNumber(number)
        // A purpose change while renting must not draft the old purpose.
        if (purposeRef.current === rentedForPurpose) draftIfNeeded(number)
      },
    })
  }

  const goToCompose = () => {
    setStepId('compose')
    // Rent the caller-ID number once, then draft with it so the script carries
    // the disclosure. A revisit reuses the number already in hand.
    if (callbackNumber) {
      draftIfNeeded(callbackNumber)
      return
    }
    rentCallbackNumber()
  }

  const handleToneChange = (t: SocialTone) => {
    setTone(t)
    if (purpose) requestDraft(purpose, t, callbackNumber)
    // The new draft supersedes the script a recording was read against.
    invalidateRecording()
  }

  const handleRegenerate = () => {
    if (purpose) {
      requestDraft(purpose, tone, callbackNumber)
      invalidateRecording()
    }
  }

  const hasBuilderSelection = hasAnyVoterFileSelection(
    audience.builderFilters,
    audience.builderSupportStatus,
    audience.builderPrecincts,
  )

  const dirty = purpose !== null

  const audienceCta: FlowShellCta =
    audience.mode === 'filters'
      ? {
          label: audience.builderCounting
            ? 'Continue'
            : `Continue (${(audience.builderCount ?? 0).toLocaleString()})`,
          onClick: () => audience.setMode('name'),
          disabled:
            !hasBuilderSelection ||
            audience.builderCounting ||
            audience.builderZeroMatch ||
            audience.builderCapError,
          loading: hasBuilderSelection && audience.builderCounting,
        }
      : audience.mode === 'name'
        ? {
            label: 'Create list',
            onClick: () => {
              void handleCreateListContinue()
            },
            disabled: audience.builderName.trim().length === 0,
            loading: audience.createListPending,
          }
        : {
            label:
              audience.reachableCount !== null
                ? `Continue (${audience.reachableCount.toLocaleString()})`
                : 'Continue',
            onClick: goToSchedule,
            disabled:
              !audience.selectedList ||
              audience.reachableLoading ||
              audience.reachableCount === null ||
              audience.reachableCount === 0,
          }

  const cta: FlowShellCta | null =
    stepId === 'audience'
      ? audienceCta
      : stepId === 'schedule'
        ? {
            label: 'Continue',
            onClick: goToCompose,
            disabled: campaignName.trim().length === 0 || !isScheduleValid,
          }
        : stepId === 'compose'
          ? {
              label: 'Continue',
              onClick: () => setStepId('review'),
              // Advancing requires a saved recording that also passed the
              // compliance check — the audio is the deliverable, and it must
              // carry the spoken disclosures.
              disabled:
                recorder.status !== 'saved' ||
                complianceMutation.data?.passed !== true,
            }
          : stepId === 'review'
            ? {
                label: 'Continue to payment',
                onClick: () => setStepId('pay'),
              }
            : // The pay step owns its own submit button (the Stripe confirm
              // must run inside the Elements context), so the shell shows no CTA.
              null

  return (
    <OutreachFlowShell
      open={open}
      onClose={onClose}
      title={STEP_TITLES[stepId]}
      currentStep={stepIndex + 1}
      totalSteps={STEP_ORDER.length}
      onBack={stepIndex > 0 ? handleBack : undefined}
      cta={cta}
      dirty={dirty}
    >
      {stepId === 'purpose' ? (
        <RobocallPurposeStep
          selected={purpose}
          onSelect={handleSelectPurpose}
        />
      ) : stepId === 'audience' ? (
        <>
          <OutreachAudienceStep
            channel="robocall"
            copy={ROBOCALL_AUDIENCE_COPY}
            mode={audience.mode}
            lists={audience.lists}
            listsLoading={audience.listsLoading}
            selectedId={audience.selectedListId}
            onSelect={audience.onSelect}
            onStartBuilder={audience.startBuilder}
            reachableCount={audience.reachableCount}
            reachableLoading={audience.reachableLoading}
            pricePerContact={PRICE_PER_CONTACT}
            builderFilters={audience.builderFilters}
            onBuilderFiltersChange={audience.setBuilderFilters}
            builderSupportStatus={audience.builderSupportStatus}
            builderPrecincts={audience.builderPrecincts}
            onBuilderPrecinctsChange={audience.setBuilderPrecincts}
            precinctOptions={audience.precinctOptions}
            onBuilderSupportStatusChange={audience.setBuilderSupportStatus}
            builderName={audience.builderName}
            onBuilderNameChange={audience.setBuilderName}
            isElectedOfficial={audience.isElectedOfficial}
            builderCount={audience.builderCount}
            builderCounting={audience.builderCounting}
            builderCapError={audience.builderCapError}
            builderCountErrorMessage={audience.builderCountErrorMessage}
          />
          {audience.createListError && audience.mode === 'name' && (
            <p className="mt-4 text-sm text-destructive">
              We couldn&apos;t create this list. Try again.
            </p>
          )}
        </>
      ) : stepId === 'schedule' ? (
        <RobocallScheduleStep
          campaignName={campaignName}
          onCampaignNameChange={setCampaignName}
          scheduledDay={scheduledDay}
          onScheduledDayChange={setScheduledDay}
          time={time}
          onTimeChange={setTime}
          timeZone={timeZone}
          minLeadHours={MIN_LEAD_HOURS}
          earliest={earliest}
          violates={violatesLeadTime}
        />
      ) : stepId === 'compose' ? (
        <RobocallComposeStep
          tone={tone}
          onToneChange={handleToneChange}
          isCustomPurpose={isCustomPurpose}
          draft={script}
          onDraftChange={setScript}
          onRegenerate={handleRegenerate}
          isDrafting={draftMutation.isPending}
          isDraftError={draftMutation.isError}
          audienceName={audience.selectedList?.name ?? 'your list'}
          callbackNumber={callbackNumber}
          isRentingNumber={rentMutation.isPending}
          rentError={rentMutation.isError}
          onRetryNumber={rentCallbackNumber}
          recorder={recorder}
          maxSeconds={MAX_RECORDING_SECONDS}
          onSaveRecording={handleSaveRecording}
          isUploading={audioUpload.isUploading}
          uploadError={audioUpload.error}
          complianceChecking={complianceMutation.isPending}
          complianceVerdict={complianceMutation.data ?? null}
          complianceError={complianceMutation.isError}
          onRetryCompliance={retryCompliance}
        />
      ) : stepId === 'review' ? (
        <RobocallReviewStep
          campaignName={campaignName}
          audienceName={audience.selectedList?.name ?? 'your list'}
          reachCount={audience.reachableCount ?? 0}
          pricePerContact={PRICE_PER_CONTACT}
          scheduledAt={scheduledAt}
          timeZone={timeZone}
          callbackNumber={callbackNumber}
          recording={recorder.recording}
          script={script}
        />
      ) : (
        <RobocallPayStep
          voterFileFilterId={audience.selectedListId}
          audioKey={audioUpload.key}
          callbackNumber={callbackNumber}
          scheduledAt={scheduledAt}
          timeZone={timeZone}
          script={script}
          campaignName={campaignName}
          outcome={payOutcome}
          onOutcome={setPayOutcome}
        />
      )}
    </OutreachFlowShell>
  )
}
