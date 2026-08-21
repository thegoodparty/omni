'use client'

import { useEffect, useState } from 'react'
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
import { RobocallPurposeStep } from './RobocallPurposeStep'

// Steps grow as later slices land (schedule, record/compliance, review + pay).
// For now: pick a purpose, pick/build the audience, then a placeholder for the
// not-yet-built remainder.
type StepId = 'purpose' | 'audience' | 'placeholder'
const STEP_ORDER: StepId[] = ['purpose', 'audience', 'placeholder']

const STEP_TITLES: Record<StepId, string> = {
  purpose: 'What do you want to do?',
  audience: 'Who do you want to reach?',
  placeholder: 'Robocall is coming soon',
}

// Robocall dials landlines, so the reachable count and the in-flow builder
// count both use the landline dimension: reachability.robocall for a saved
// list, and a { hasLandline: true } overlay on the builder count. The overlay
// is count-only — the saved list itself stays general (see useOutreachAudience).
const ROBOCALL_AUDIENCE_COPY: OutreachAudienceCopy = {
  pickerTitle: 'Who do you want to reach?',
  pickerBody: 'Pick a saved voter list. We only call voters with a landline.',
  filtersTitle: 'Build a voter list',
  filtersBody: 'Pick filters to define who this campaign calls.',
  nameTitle: 'Name your list',
  nameBody: 'You can rename it any time.',
  reachVerb: 'Call',
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
    resetAudience()
  }, [open, resetAudience])

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

  const handleCreateListContinue = async () => {
    try {
      await audience.createList()
      setStepId('placeholder')
    } catch {
      // createListError renders the inline message below the step.
    }
  }

  const hasBuilderSelection = hasAnyVoterFileSelection(
    audience.builderFilters,
    audience.builderSupportStatus,
  )

  const dirty = purpose !== null

  const cta: FlowShellCta | null =
    stepId !== 'audience'
      ? null
      : audience.mode === 'filters'
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
              onClick: () => setStepId('placeholder'),
              disabled:
                !audience.selectedList ||
                audience.reachableLoading ||
                audience.reachableCount === null ||
                audience.reachableCount === 0,
            }

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
      ) : (
        <div className="space-y-2 py-8 text-center">
          <h3 className="text-xl font-semibold text-foreground">
            More coming soon
          </h3>
          <p className="text-base text-muted-foreground">
            The rest of the robocall flow (schedule, recording, and payment) is
            still being built.
          </p>
        </div>
      )}
    </OutreachFlowShell>
  )
}
