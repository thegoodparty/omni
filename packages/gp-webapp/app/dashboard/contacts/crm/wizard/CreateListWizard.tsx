'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import {
  Button,
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Stepper,
} from '@styleguide'
import { useSnackbar } from 'helpers/useSnackbar'
import { numberFormatter } from 'helpers/numberHelper'
import { clientRequest } from 'gpApi/typed-request'
import { useContactsTable } from '../ContactsTableProvider'
import type { SupportStatusRollup } from '../shared/contacts-types'
import {
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
  const { isElectedOfficial, isWinContext, refreshCustomSegments } =
    useContactsTable()
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
      await refreshCustomSegments()
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

  const buildLabel =
    isLoading || count === undefined
      ? 'Build your list'
      : `Build your list (${numberFormatter(count)})`

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-[90vw] max-w-2xl flex-col sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Create a new list</SheetTitle>
          <Stepper currentStep={step} totalSteps={TOTAL_STEPS} />
        </SheetHeader>

        <div ref={bodyRef} className="flex-1 overflow-y-auto px-6">
          {step === 1 && <BranchStep selected={branch} onSelect={setBranch} />}
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
        </div>

        <SheetFooter className="flex-row items-center justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={step === 1 ? () => onOpenChange(false) : handleBack}
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>
          {step < 3 ? (
            <Button
              type="button"
              onClick={handleNext}
              disabled={step === 1 ? !branch : !isStep2Valid}
            >
              Next
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              loading={createMutation.isPending}
            >
              {buildLabel}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
