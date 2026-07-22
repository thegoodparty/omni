'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, DrawerTitle, Stepper } from '@styleguide'
import { useSnackbar } from 'helpers/useSnackbar'
import { numberFormatter } from 'helpers/numberHelper'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useContactsTable } from '../ContactsTableProvider'
import { getContactsLabels } from '../../../shared/contactsLabels'
import CrmSheet from '../shared/CrmSheet'
import type { SupportStatusRollup } from '../shared/contacts-types'
import {
  countSelectedFilterCategories,
  hasAnyVoterFileSelection,
  hasPartyFilterSelection,
  transformVoterFileFiltersForBackend,
  type VoterFileFilters,
} from '../shared/voterFileFilterTransform.util'
import BranchStep, { type ListWizardBranch } from './BranchStep'
import VoterFileStep from './VoterFileStep'
import ActivityStep, {
  blankActivityCondition,
  isActivityStepValid,
  toActivityConditionPayload,
  type WizardActivityCondition,
} from './ActivityStep'
import NameStep from './NameStep'
import { useListWizardCount } from './useListWizardCount'

type WizardStepName = 'branch' | 'conditions' | 'name'

// ENG-10767: per-stage funnel events (see the ListWizard registry comment in
// analyticsHelper.ts) — this wizard is URL-stable, so RouteTracker page views
// can't see its stages.
const STAGE_VIEWED_EVENTS: Record<WizardStepName, string> = {
  branch: EVENTS.Contacts.ListWizard.MethodViewed,
  conditions: EVENTS.Contacts.ListWizard.ConditionsViewed,
  name: EVENTS.Contacts.ListWizard.NameViewed,
}

interface CreateListWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// The list creation wizard (ENG-10708 locked design): branch chooser ->
// branch-specific conditions -> name + build. Serve has no outreach
// (deferred by design, ENG-10750), so its flow drops the branch chooser and
// opens directly on the constituent-file filters as a 2-step wizard — this
// derived `steps` array is THE Serve gate; when Serve outreach ships,
// reopen the branch here.
export default function CreateListWizard({
  open,
  onOpenChange,
}: CreateListWizardProps) {
  const {
    isElectedOfficial,
    isWinContext,
    isWinContextReady,
    refreshCustomSegments,
    selectList,
  } = useContactsTable()
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const bodyRef = useRef<HTMLDivElement>(null)

  // The page's "Create new list" button is disabled until isWinContextReady,
  // so the wizard never opens on an unsettled mode.
  const steps: readonly WizardStepName[] = isWinContext
    ? ['branch', 'conditions', 'name']
    : ['conditions', 'name']

  const [stepIndex, setStepIndex] = useState(0)
  const [branch, setBranch] = useState<ListWizardBranch | null>(null)
  const [demographicFilters, setDemographicFilters] =
    useState<VoterFileFilters>({})
  const [supportStatus, setSupportStatus] = useState<SupportStatusRollup[]>([])
  const [activityConditions, setActivityConditions] = useState<
    WizardActivityCondition[]
  >(() => [blankActivityCondition()])
  const [name, setName] = useState('')

  // Serve never renders the branch chooser, so its branch is a constant —
  // derived, not set on open, so no frame can render the activity branch
  // while a reset effect is still pending.
  const activeBranch: ListWizardBranch | null = isWinContext
    ? branch
    : 'voterFile'
  const stepName: WizardStepName = steps[stepIndex] ?? 'conditions'

  // ENG-10767: bumps once per wizard open, from the reset effect below, so
  // the stage-Viewed effect can't fire on the stale pre-reset stage a
  // reopened wizard renders for one commit (stepIndex resets asynchronously).
  const [openSession, setOpenSession] = useState(0)

  // Fresh wizard state every time it opens — a cancelled-then-reopened
  // wizard must not resume a half-built prior list.
  useEffect(() => {
    if (!open) return
    setStepIndex(0)
    setBranch(null)
    setDemographicFilters({})
    setSupportStatus([])
    setActivityConditions([blankActivityCondition()])
    setName('')
    setOpenSession((session) => session + 1)
  }, [open])

  // ENG-10767: stage Viewed fires on every stage entry — including Back
  // re-entry — keyed on the open session + active-stage identifier ONLY
  // (instrument-analytics-event skill rule), never on unrelated re-renders
  // (e.g. picking a branch card re-renders with the same stepName). The
  // openSession guard skips the mount run and any pre-reset stale stage; the
  // page's create button is disabled until isWinContextReady, so the context
  // is settled whenever the wizard is open.
  useEffect(() => {
    if (openSession === 0) return
    trackEvent(STAGE_VIEWED_EVENTS[stepName], {
      context: isWinContext ? 'win' : 'serve',
      ...(stepName !== 'branch' && activeBranch
        ? { branch: activeBranch }
        : {}),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSession, stepName])

  // Multi-step flow: reset scroll to the top of the sheet's own scrollable
  // body (not window) on every step change (app/dashboard/CLAUDE.md
  // convention), so a long filter list on the conditions step doesn't leave
  // the name step opening mid-scroll.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [stepIndex])

  const backendPayload = useMemo(() => {
    if (activeBranch === 'voterFile') {
      return {
        ...transformVoterFileFiltersForBackend(demographicFilters),
        ...(supportStatus.length ? { supportStatus } : {}),
      }
    }
    if (activeBranch === 'activity') {
      return {
        activityConditions: toActivityConditionPayload(activityConditions),
      }
    }
    return {}
  }, [activeBranch, demographicFilters, supportStatus, activityConditions])

  // ENG-10751: an empty voter-file selection would just recreate the
  // pre-built "All voters" list, so zero filters blocks the build (reversing
  // the ENG-10725 valid-unfiltered-submission stance).
  const isConditionsStepValid =
    activeBranch === 'voterFile'
      ? hasAnyVoterFileSelection(demographicFilters, supportStatus)
      : activeBranch === 'activity'
        ? isActivityStepValid(activityConditions)
        : false

  // The activity count stays gated on a valid selection: an incomplete
  // condition would send activityConditions: [] — the backend treats that as
  // unfiltered and the cached total would render on the build button. The
  // voter-file count deliberately fires with zero selections (ENG-10751):
  // the disabled build button still shows the live unfiltered total.
  const { count, isLoading, isCapError, errorMessage } = useListWizardCount(
    backendPayload,
    activeBranch === 'voterFile' ||
      (activeBranch === 'activity' && isConditionsStepValid),
  )

  const handleNext = () => {
    if (stepName === 'branch' && branch) {
      trackEvent(EVENTS.Contacts.ListWizard.MethodCompleted, {
        context: isWinContext ? 'win' : 'serve',
        branch,
      })
      setStepIndex(stepIndex + 1)
    } else if (stepName === 'conditions' && isConditionsStepValid) {
      trackEvent(EVENTS.Contacts.ListWizard.ConditionsCompleted, {
        context: isWinContext ? 'win' : 'serve',
        ...(activeBranch ? { branch: activeBranch } : {}),
      })
      setStepIndex(stepIndex + 1)
    }
  }

  const handleBack = () => {
    setStepIndex(Math.max(stepIndex - 1, 0))
  }

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      clientRequest('POST /v1/voters/voter-file/filter', payload).then(
        (res) => res.data,
      ),
    onSuccess: async (response) => {
      successSnackbar('List created successfully')
      // ENG-10709: fire exactly once per successful create, never on a
      // failed create or wizard abandon (createMutation.onError below has no
      // matching trackEvent). Gated on isWinContextReady like the other
      // product-specific events in this surface, so a not-yet-settled mode
      // can't emit the wrong variant.
      if (isWinContextReady) {
        // ENG-10767: the name stage's funnel completion — fires alongside
        // the List Created outcome events below (skill rule: a final stage
        // that both completes the funnel and produces the outcome fires
        // both; they answer different questions).
        trackEvent(EVENTS.Contacts.ListWizard.NameCompleted, {
          context: isWinContext ? 'win' : 'serve',
          ...(activeBranch ? { branch: activeBranch } : {}),
        })
        if (activeBranch === 'voterFile') {
          const variableCount =
            countSelectedFilterCategories(demographicFilters) +
            (supportStatus.length > 0 ? 1 : 0)
          trackEvent(
            isWinContext
              ? EVENTS.VoterData.ListCreated
              : EVENTS.ConstituentData.ListCreated,
            {
              variableCount,
              ...(isWinContext
                ? { hasParty: hasPartyFilterSelection(demographicFilters) }
                : {}),
            },
          )
        } else if (activeBranch === 'activity') {
          // Filtered defensively (isConditionsStepValid already guarantees
          // every row has a channel by submit time) so a stray blank row
          // can't produce an 'any' entry that didn't come from a real
          // condition.
          const validConditions = activityConditions.filter(
            (condition) => condition.outreachType !== '',
          )
          const sourceCampaign = validConditions.length
            ? validConditions
                .map((condition) => condition.outreachName ?? 'any')
                .join(', ')
            : 'any'
          // Array, not a joined string: Amplitude/HubSpot property
          // definitions allow a scalar-array custom property, and this event
          // doesn't drive a HubSpot email (see instrument-analytics-event
          // skill's flatten-for-email rule), so no flattening is needed here.
          const actionFilter = Array.from(
            new Set(validConditions.flatMap((condition) => condition.actions)),
          )
          trackEvent(
            isWinContext
              ? EVENTS.VoterData.ActivityListCreated
              : EVENTS.ConstituentData.ActivityListCreated,
            { sourceCampaign, actionFilter },
          )
        }
      }
      // A failed cache refresh must not strand the sheet open after the
      // create itself succeeded (React Query doesn't catch onSuccess throws;
      // DeleteSegment guards the same call).
      await refreshCustomSegments().catch((error) =>
        console.log('Error refreshing segments after create', error),
      )
      onOpenChange(false)
      // ENG-10707/10725: land on the new list's detail sheet instead of the
      // main table — refreshCustomSegments already invalidated
      // ['custom-segments', orgSlug], so the sheet finds this list as soon
      // as it opens. selectList is shallow, so the index stays mounted.
      // Deferred so wizardOpen(false) commits before the detail sheet opens:
      // pushState updates usePathname outside the React batch, which could
      // otherwise render a frame with both full-screen drawers stacked.
      setTimeout(() => selectList(response.id), 0)
    },
    onError: () => {
      errorSnackbar('Failed to create list')
    },
  })

  const trimmedName = name.trim()
  // !isLoading: a save that races the debounced count would omit voterCount
  // and let the server default it to 0 — the exact display bug ENG-10769
  // fixes. A failed count still submits (count stays a nice-to-have).
  const canSubmit =
    trimmedName.length > 0 && !createMutation.isPending && !isLoading

  const handleSubmit = () => {
    if (!canSubmit) return
    // ENG-10769: persist the live count — the server defaults voterCount to
    // 0, and the outreach page's Voters column reads the stored value, so a
    // list saved without it shows every campaign as reaching 0 voters. A
    // still-loading/error count is omitted rather than persisted wrong.
    createMutation.mutate({
      name: trimmedName,
      ...backendPayload,
      ...(typeof count === 'number' ? { voterCount: count } : {}),
    })
  }

  const peopleNoun = isWinContext ? 'voters' : 'constituents'
  const labels = getContactsLabels(isWinContext)

  // Lovable-locked titles (ENG-10725): the branch and name steps are
  // mode-neutral; the conditions step shares ONE heading across both
  // branches — "Build a voter list" / "Build a constituent list" (via
  // contactsLabels.ts, the one place that copy lives), matching the
  // prototype's single step-2 title.
  const stepTitle =
    stepName === 'branch'
      ? 'How do you want to build this list?'
      : stepName === 'name'
        ? 'Name your list'
        : labels.wizardVoterFileStepTitle

  const buildLabel =
    isLoading || count === undefined
      ? 'Build your list'
      : `Build your list (${numberFormatter(count)})`

  return (
    <CrmSheet
      open={open}
      onOpenChange={onOpenChange}
      onBack={stepIndex > 0 ? handleBack : undefined}
      bodyRef={bodyRef}
      header={
        <>
          <DrawerTitle className="text-base font-semibold">
            {stepTitle}
          </DrawerTitle>
          <Stepper
            currentStep={stepIndex + 1}
            totalSteps={steps.length}
            labelClassName="text-xs"
          />
        </>
      }
      footer={
        <>
          {stepName === 'branch' && (
            <Button
              type="button"
              className="w-full text-sm"
              onClick={handleNext}
              disabled={!branch}
            >
              Continue
            </Button>
          )}
          {stepName === 'conditions' && (
            <Button
              type="button"
              className="w-full text-sm"
              onClick={handleNext}
              disabled={!isConditionsStepValid}
            >
              {buildLabel}
            </Button>
          )}
          {stepName === 'name' && (
            <Button
              type="button"
              className="w-full text-sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              loading={createMutation.isPending}
            >
              Save list
            </Button>
          )}
        </>
      }
    >
      {stepName === 'branch' && (
        <BranchStep
          selected={branch}
          onSelect={setBranch}
          isWinContext={isWinContext}
        />
      )}
      {stepName === 'conditions' && activeBranch === 'voterFile' && (
        <VoterFileStep
          filters={demographicFilters}
          onFiltersChange={setDemographicFilters}
          supportStatus={supportStatus}
          onSupportStatusChange={setSupportStatus}
          isElectedOfficial={isElectedOfficial}
        />
      )}
      {stepName === 'conditions' && activeBranch === 'activity' && (
        <ActivityStep
          conditions={activityConditions}
          onChange={setActivityConditions}
        />
      )}
      {stepName === 'name' && (
        <NameStep
          name={name}
          onNameChange={setName}
          count={count}
          isCounting={isLoading}
          isCapError={isCapError}
          countErrorMessage={errorMessage}
          peopleNoun={peopleNoun}
        />
      )}
    </CrmSheet>
  )
}
