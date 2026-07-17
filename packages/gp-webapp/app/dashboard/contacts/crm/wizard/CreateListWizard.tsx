'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import {
  ArrowLeftIcon,
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  Stepper,
} from '@styleguide'
import { useSnackbar } from 'helpers/useSnackbar'
import { numberFormatter } from 'helpers/numberHelper'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useContactsTable } from '../ContactsTableProvider'
import { getContactsLabels } from '../../../shared/contactsLabels'
import type { SupportStatusRollup } from '../shared/contacts-types'
import {
  countSelectedFilterCategories,
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

const TOTAL_STEPS = 3

type WizardStep = 1 | 2 | 3

interface CreateListWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// The 3-step list creation wizard (ENG-10708 locked design): branch chooser
// -> branch-specific conditions -> name + build. Both Win and Serve get the
// identical surface; only the constituent/voter noun differs.
export default function CreateListWizard({
  open,
  onOpenChange,
}: CreateListWizardProps) {
  const {
    isElectedOfficial,
    isWinContext,
    isWinContextReady,
    refreshCustomSegments,
  } = useContactsTable()
  const router = useRouter()
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const bodyRef = useRef<HTMLDivElement>(null)

  const [step, setStep] = useState<WizardStep>(1)
  const [branch, setBranch] = useState<ListWizardBranch | null>(null)
  const [demographicFilters, setDemographicFilters] =
    useState<VoterFileFilters>({})
  const [supportStatus, setSupportStatus] = useState<SupportStatusRollup[]>([])
  const [activityConditions, setActivityConditions] = useState<
    WizardActivityCondition[]
  >(() => [blankActivityCondition()])
  const [name, setName] = useState('')

  // Fresh wizard state every time it opens — a cancelled-then-reopened
  // wizard must not resume a half-built prior list.
  useEffect(() => {
    if (!open) return
    setStep(1)
    setBranch(null)
    setDemographicFilters({})
    setSupportStatus([])
    setActivityConditions([blankActivityCondition()])
    setName('')
  }, [open])

  // Multi-step flow: reset scroll to the top of the sheet's own scrollable
  // body (not window) on every step change (app/dashboard/CLAUDE.md
  // convention), so a long filter list on step 2 doesn't leave step 3 opening
  // mid-scroll.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [step])

  const backendPayload = useMemo(() => {
    if (branch === 'voterFile') {
      return {
        ...transformVoterFileFiltersForBackend(demographicFilters),
        ...(supportStatus.length ? { supportStatus } : {}),
      }
    }
    if (branch === 'activity') {
      return {
        activityConditions: toActivityConditionPayload(activityConditions),
      }
    }
    return {}
  }, [branch, demographicFilters, supportStatus, activityConditions])

  const isStep2Valid =
    branch === 'voterFile'
      ? true
      : branch === 'activity'
        ? isActivityStepValid(activityConditions)
        : false

  // Gate the count on a valid selection: an activity branch with no complete
  // condition would send activityConditions: [] — the backend treats that as
  // unfiltered and the cached total would render on the build button.
  const { count, isLoading, isCapError, errorMessage } = useListWizardCount(
    backendPayload,
    branch !== null && isStep2Valid,
  )

  const handleNext = () => {
    if (step === 1 && branch) setStep(2)
    else if (step === 2 && isStep2Valid) setStep(3)
  }

  const handleBack = () => {
    if (step === 2) setStep(1)
    else if (step === 3) setStep(2)
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
        if (branch === 'voterFile') {
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
        } else if (branch === 'activity') {
          // Filtered defensively (isStep2Valid already guarantees every row
          // has a channel by submit time) so a stray blank row can't produce
          // an 'any' entry that didn't come from a real condition.
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
      // ENG-10707: land on the new list-detail page instead of selecting the
      // segment in the (soon superseded) main table — refreshCustomSegments
      // already invalidated ['custom-segments', orgSlug], so the detail page
      // finds this list as soon as it mounts.
      router.push(`/dashboard/contacts/lists/${response.id}`)
    },
    onError: () => {
      errorSnackbar('Failed to create list')
    },
  })

  const trimmedName = name.trim()
  const canSubmit = trimmedName.length > 0 && !createMutation.isPending

  const handleSubmit = () => {
    if (!canSubmit) return
    createMutation.mutate({ name: trimmedName, ...backendPayload })
  }

  const peopleNoun = isWinContext ? 'voters' : 'constituents'
  const labels = getContactsLabels(isWinContext)

  // ENG-10721 locked-prototype titles: step 1 and step 3 are mode-neutral;
  // step 2's voter-file title carries the voter/constituent noun (via
  // contactsLabels.ts, the one place that copy lives), the activity branch
  // avoids the noun entirely since it isn't demographic-file specific.
  const stepTitle =
    step === 1
      ? 'How do you want to build this list?'
      : step === 3
        ? 'Name your list'
        : branch === 'voterFile'
          ? labels.wizardVoterFileStepTitle
          : 'Build a list from outreach activity'

  // Step 2's footer CTA always reads "Build your list (N)" (both branches
  // share the same slot); the muted/saturated distinction from the prototype
  // only applies to the voter-file branch, where an empty selection is still
  // a valid (unfiltered) submission — the activity branch's disabled state
  // already communicates "not ready yet" via isStep2Valid.
  const hasVoterFileSelection =
    Object.values(demographicFilters).some(Boolean) || supportStatus.length > 0
  const isStep2Muted = branch === 'voterFile' && !hasVoterFileSelection

  const step2Label =
    isLoading || count === undefined
      ? 'Build your list'
      : `Build your list (${numberFormatter(count)})`

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="bottom">
      <DrawerContent className="mx-auto w-full max-w-2xl">
        <DrawerHandle />
        <DrawerHeader className="gap-3 border-b border-border">
          <div className="relative flex items-center justify-center">
            {step > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="small"
                onClick={handleBack}
                className="absolute left-0 gap-1 px-2"
              >
                <ArrowLeftIcon className="size-4" aria-hidden />
                Back
              </Button>
            )}
            <DrawerTitle className="text-center">{stepTitle}</DrawerTitle>
          </div>
          <Stepper currentStep={step} totalSteps={TOTAL_STEPS} />
        </DrawerHeader>

        <DrawerBody ref={bodyRef}>
          {step === 1 && (
            <BranchStep
              selected={branch}
              onSelect={setBranch}
              isWinContext={isWinContext}
            />
          )}
          {step === 2 && branch === 'voterFile' && (
            <VoterFileStep
              filters={demographicFilters}
              onFiltersChange={setDemographicFilters}
              supportStatus={supportStatus}
              onSupportStatusChange={setSupportStatus}
              isElectedOfficial={isElectedOfficial}
            />
          )}
          {step === 2 && branch === 'activity' && (
            <ActivityStep
              conditions={activityConditions}
              onChange={setActivityConditions}
            />
          )}
          {step === 3 && (
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
        </DrawerBody>

        <DrawerFooter>
          {step === 1 && (
            <Button
              type="button"
              className="w-full"
              onClick={handleNext}
              disabled={!branch}
            >
              Continue
            </Button>
          )}
          {step === 2 && (
            <Button
              type="button"
              className={isStep2Muted ? 'w-full opacity-50' : 'w-full'}
              onClick={handleNext}
              disabled={!isStep2Valid}
            >
              {step2Label}
            </Button>
          )}
          {step === 3 && (
            <Button
              type="button"
              className="w-full"
              onClick={handleSubmit}
              disabled={!canSubmit}
              loading={createMutation.isPending}
            >
              Save list
            </Button>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
