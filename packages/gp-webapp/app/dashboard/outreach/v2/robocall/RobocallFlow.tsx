'use client'

import { useEffect, useRef, useState } from 'react'
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
import { combineScheduledAt, resolveCampaignTimeZone } from './scheduleTimeZone'

// Steps grow as later slices land (record/compliance, review + pay). For now:
// pick a purpose, pick/build the audience, choose when it goes out, then a
// placeholder for the not-yet-built remainder.
type StepId = 'purpose' | 'audience' | 'schedule' | 'placeholder'
const STEP_ORDER: StepId[] = ['purpose', 'audience', 'schedule', 'placeholder']

const STEP_TITLES: Record<StepId, string> = {
  purpose: 'What do you want to do?',
  audience: 'Who are you calling?',
  schedule: 'When should it go out?',
  placeholder: 'Robocall is coming soon',
}

// Hard 48h lead time (the compliance floor the design enforces). No upper
// bound here — the payment-window ceiling is a pay-step concern.
const MIN_LEAD_HOURS = 48
const MIN_LEAD_MS = MIN_LEAD_HOURS * 60 * 60 * 1000

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

  // Fresh flow every open — a cancelled-then-reopened flow must not resume.
  useEffect(() => {
    if (!open) return
    setStepId('purpose')
    setPurpose(null)
    setCampaignName('')
    lastAutoName.current = ''
    setScheduledDay(undefined)
    setTime('')
    setNow(new Date())
    resetAudience()
  }, [open, resetAudience])

  // Validate against the combined UTC instant so it's tz-correct: the send must
  // be at least 48h out. `earliest` (now + lead) drives both the "earliest
  // send" hint and the violation alert, mirroring the design's flowWhen.
  const scheduledAt = combineScheduledAt(scheduledDay, time, timeZone)
  const earliest = new Date(now.getTime() + MIN_LEAD_MS)
  const violatesLeadTime =
    scheduledAt !== null && scheduledAt.getTime() < earliest.getTime()
  const isScheduleValid = scheduledAt !== null && !violatesLeadTime

  const stepIndex = STEP_ORDER.indexOf(stepId)

  const handleSelectPurpose = (selected: RobocallPurpose) => {
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

  const hasBuilderSelection = hasAnyVoterFileSelection(
    audience.builderFilters,
    audience.builderSupportStatus,
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
            onClick: () => setStepId('placeholder'),
            disabled: campaignName.trim().length === 0 || !isScheduleValid,
          }
        : null

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
      ) : (
        <div className="space-y-2 py-8 text-center">
          <h3 className="text-xl font-semibold text-foreground">
            More coming soon
          </h3>
          <p className="text-base text-muted-foreground">
            The rest of the robocall flow (recording and payment) is still being
            built.
          </p>
        </div>
      )}
    </OutreachFlowShell>
  )
}
