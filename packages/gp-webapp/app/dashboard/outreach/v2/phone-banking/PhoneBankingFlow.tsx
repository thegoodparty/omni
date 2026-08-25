'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import {
  PHONE_BANKING_MAX_SHEET_COUNT,
  PHONE_BANKING_SHEET_SIZE,
  type PhoneBankingCreateResponse,
  type PhoneBankingPurpose,
  type PhoneBankingScriptDraftRequest,
  type SocialTone,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { extractApiErrorInfo } from 'helpers/extractApiErrorInfo'
import { hasAnyVoterFileSelection } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import { OUTREACH_OPTIONS } from 'app/dashboard/outreach/components/OutreachCreateCards'
import { OutreachFlowShell, type FlowShellCta } from '../OutreachFlowShell'
import {
  OutreachAudienceStep,
  type OutreachAudienceCopy,
} from '../audience/OutreachAudienceStep'
import { useOutreachAudience } from '../audience/useOutreachAudience'
import { phoneBankingPurposeNameSuggestion } from '../phoneBankingPurposes'
import { PurposeStep } from './PurposeStep'
import { ScriptStep } from './ScriptStep'
import { SheetCountStep } from './SheetCountStep'
import { DownloadStep } from './DownloadStep'

type StepId = 'purpose' | 'who' | 'script' | 'sheets' | 'download'
const STEP_ORDER: StepId[] = ['purpose', 'who', 'script', 'sheets', 'download']

const STEP_TITLES: Record<StepId, string> = {
  purpose: 'What do you want to do?',
  who: 'Who are you calling?',
  script: 'Write your call script',
  sheets: 'How many call sheets would you like me to create?',
  // Deliberately distinct from DownloadStep's own dynamic (singular/plural)
  // "ready" title — this is only the sr-only shell title, and matching
  // either variant exactly would make it collide with the visible one for
  // that variant while staying non-unique text across the two states.
  download: 'Download your call sheets',
}

const GENERIC_CREATE_ERROR_MESSAGE =
  "We couldn't create your call sheets. Try again."

// Phone banking is free (volunteers make the calls) — 0 tells the shared
// audience step to omit the cost line entirely rather than show "for $0.00".
const PRICE_PER_CONTACT =
  OUTREACH_OPTIONS.find((o) => o.type === OUTREACH_TYPES.phoneBanking)?.cost ??
  0

// ENG-10930/ENG-10931: the audience step is the shared OutreachAudienceStep +
// useOutreachAudience (same wiring as RobocallFlow) — no hardcoded
// "Recommended list" default, and the builder exposes every CRM filter
// dimension (VoterFileStep) instead of the four PhoneBankingFiltersSchema
// used to restrict it to.
const PHONE_BANKING_AUDIENCE_COPY: OutreachAudienceCopy = {
  pickerTitle: 'Who are you calling?',
  pickerBody: 'We recommend reaching all voters to increase awareness.',
  filtersTitle: 'Build a voter list',
  filtersBody: 'Pick filters to define who this campaign reaches.',
  nameTitle: 'Name your list',
  nameBody: 'You can rename it any time.',
  reachVerb: 'Reach',
  reachNoun: 'voters by phone banking',
  unitCostLabel: '',
}

interface PhoneBankingFlowProps {
  open: boolean
  onClose: () => void
  onSaved?: (outreachId: number, name: string) => void
}

// Flow state is flat client state owned here (phase 1 TDD, same convention
// as SocialFlow/RobocallFlow): no server drafts — nothing persists until the
// audience is picked/built and the final create call, and reopening starts
// fresh.
export const PhoneBankingFlow = ({
  open,
  onClose,
  onSaved,
}: PhoneBankingFlowProps) => {
  const router = useRouter()
  const [stepId, setStepId] = useState<StepId>('purpose')
  const [purpose, setPurpose] = useState<PhoneBankingPurpose | null>(null)

  const [tone, setTone] = useState<SocialTone>('warm')
  const [script, setScript] = useState('')
  const [instructions, setInstructions] = useState('')
  const [sheetCount, setSheetCount] = useState(1)
  // Whether the candidate has manually changed the sheet count — gates the
  // audience-derived default below so it never clobbers a deliberate choice.
  const [sheetCountEdited, setSheetCountEdited] = useState(false)
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [saved, setSaved] = useState(false)
  const [createResponse, setCreateResponse] =
    useState<PhoneBankingCreateResponse | null>(null)

  // Guards against an out-of-order draft response (or one from a closed
  // flow) clobbering a newer draft — same convention as SocialFlow.
  const draftRequestRef = useRef(0)

  const audience = useOutreachAudience({
    open,
    active: stepId === 'who',
    reachabilityKey: 'phoneBanking',
  })
  const { reset: resetAudience } = audience

  const draftMutation = useMutation({
    mutationFn: async (input: PhoneBankingScriptDraftRequest) => {
      const { data } = await clientRequest(
        'POST /v1/outreach/phone-banking/draft',
        input,
      )
      return data.draft
    },
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      const voterFileFilterId = audience.selectedListId
      if (voterFileFilterId === null) {
        throw new Error('No audience selected')
      }
      const { data } = await clientRequest('POST /v1/phone-banking/lists', {
        name: name.trim(),
        script: script.trim(),
        sheetCount,
        purpose: purpose as PhoneBankingPurpose,
        voterFileFilterId,
      })
      return data
    },
    onSuccess: (response) => {
      setCreateResponse(response)
      setSaved(true)
      setStepId('download')
      trackEvent(EVENTS.Outreach.PhoneBanking.ListCreated, {
        product: 'phoneBanking',
        // Always true now: every audience is a saved VoterFileFilter (picked
        // or just built) — the filter-less "All voters" default is gone
        // (ENG-10930). Kept for analytics-schema continuity.
        filtersApplied: true,
        listSize: response.personCount,
      })
      if (response.outreachId != null) {
        onSaved?.(response.outreachId, response.name)
      }
    },
  })

  const { mutate: draftMutate, reset: resetDraftMutation } = draftMutation
  const { reset: resetCreateMutation } = createMutation

  // Fresh flow every open — a cancelled-then-reopened flow must not resume a
  // half-built list (same convention as SocialFlow).
  useEffect(() => {
    if (!open) return
    draftRequestRef.current += 1
    setStepId('purpose')
    setPurpose(null)
    setTone('warm')
    setScript('')
    setInstructions('')
    setSheetCount(1)
    setSheetCountEdited(false)
    setName('')
    setNameEdited(false)
    setSaved(false)
    setCreateResponse(null)
    resetDraftMutation()
    resetCreateMutation()
    resetAudience()
  }, [open, resetDraftMutation, resetCreateMutation, resetAudience])

  // Sizes the default sheet count to the audience once it resolves, instead
  // of leaving it at 1 (ENG-10941) — reachableCount counts PEOPLE while
  // entries are distinct PHONES (households collapse), so this is an
  // upper-bound heuristic, fine for a default. Skipped once the candidate has
  // touched the field themselves.
  useEffect(() => {
    if (!open) return
    if (sheetCountEdited) return
    if (audience.reachableCount === null) return
    setSheetCount(
      Math.min(
        PHONE_BANKING_MAX_SHEET_COUNT,
        Math.max(
          1,
          Math.ceil(audience.reachableCount / PHONE_BANKING_SHEET_SIZE),
        ),
      ),
    )
  }, [open, sheetCountEdited, audience.reachableCount])

  const handleSheetCountChange = (count: number) => {
    setSheetCountEdited(true)
    setSheetCount(count)
  }

  const stepIndex = STEP_ORDER.indexOf(stepId)

  const audienceLabel = audience.selectedList?.name ?? ''

  // Requests an AI script draft for the given purpose/tone; with
  // currentDraft it polishes that text in place (Improve with AI) instead
  // of writing fresh — the one generated path allowed for the custom
  // purpose, mirroring SocialFlow's requestDraft. previousDraft rides only
  // on a fresh generation (Regenerate / a tone change) — it tells the model
  // what the candidate just rejected so a re-roll actually varies
  // (ENG-10937). instructions is the candidate's own freeform steering and
  // applies on either path (ENG-10936).
  const requestDraft = (
    nextPurpose: PhoneBankingPurpose | null,
    nextTone: SocialTone,
    currentDraft?: string,
    previousDraft?: string,
  ) => {
    if (!nextPurpose) return
    if (nextPurpose === 'custom' && currentDraft === undefined) return
    const requestId = ++draftRequestRef.current
    const trimmedInstructions = instructions.trim()
    draftMutate(
      {
        purpose: nextPurpose,
        tone: nextTone,
        ...(currentDraft === undefined ? {} : { currentDraft }),
        ...(previousDraft === undefined ? {} : { previousDraft }),
        ...(trimmedInstructions === ''
          ? {}
          : { instructions: trimmedInstructions }),
      },
      {
        onSuccess: (generated) => {
          if (requestId !== draftRequestRef.current) return
          setScript(generated)
        },
      },
    )
  }

  const handleSelectPurpose = (selected: PhoneBankingPurpose) => {
    setPurpose(selected)
    // Reset tone/script state on every purpose pick (including re-picks after
    // Back), not just the first one — otherwise picking 'custom' after
    // viewing another purpose's script carries that script over instead of
    // starting blank (custom skips the draft call, so nothing else clears
    // it), and the tone pill can show a stale selection that doesn't match
    // the newly requested draft's tone.
    setTone('warm')
    setScript('')
    setStepId('who')
    requestDraft(selected, 'warm')
  }

  const handleToneChange = (nextTone: SocialTone) => {
    if (nextTone === tone) return
    setTone(nextTone)
    if (!purpose || purpose === 'custom') return
    requestDraft(purpose, nextTone, undefined, script.trim() || undefined)
  }

  const handleScriptChange = (value: string) => {
    setScript(value)
    if (draftMutation.isError) resetDraftMutation()
  }

  // Auto-suggests the campaign name from the purpose on entering the script
  // step — only while the user hasn't typed their own (nameEdited). The
  // custom purpose gets no suggestion: the caller is writing their own script,
  // so there is nothing to infer a name from.
  useEffect(() => {
    if (stepId !== 'script') return
    if (nameEdited) return
    if (!purpose || purpose === 'custom') return
    setName(phoneBankingPurposeNameSuggestion(purpose))
  }, [stepId, purpose, nameEdited])

  const handleCreateListContinue = async () => {
    try {
      await audience.createList()
      setStepId('script')
    } catch {
      // createListError renders the inline message below the step.
    }
  }

  const handleBack = () => {
    // Within the builder, Back walks the sub-modes: name -> filters (keeps the
    // built filters), filters -> picker (resetBuilder clears them).
    if (stepId === 'who' && audience.mode === 'name') {
      // Drop any failed-create error so it can't re-flash when the user
      // returns to the name step; keep the built filters.
      audience.clearCreateError()
      audience.setMode('filters')
      return
    }
    if (stepId === 'who' && audience.mode === 'filters') {
      audience.resetBuilder()
      return
    }
    const previous = STEP_ORDER[stepIndex - 1]
    if (!previous) return
    // Backing OFF the who step discards the picked list so a re-entry starts
    // from an empty picker instead of resuming a selection the user just
    // backed out of. Backing INTO who from a later step keeps the selection.
    if (stepId === 'who') resetAudience()
    setStepId(previous)
  }

  const hasBuilderSelection = hasAnyVoterFileSelection(
    audience.builderFilters,
    audience.builderSupportStatus,
  )

  const dirty = !saved && purpose !== null

  const createErrorMessage = createMutation.isError
    ? (extractApiErrorInfo(
        createMutation.error instanceof FetchError
          ? createMutation.error.data
          : undefined,
      ).message ?? GENERIC_CREATE_ERROR_MESSAGE)
    : null

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
            onClick: () => setStepId('script'),
            disabled:
              !audience.selectedList ||
              audience.reachableLoading ||
              audience.reachableCount === null ||
              audience.reachableCount === 0,
            loading: audience.reachableLoading,
          }

  const cta: FlowShellCta | null = saved
    ? {
        label: 'Go to call list',
        onClick: () => {
          if (!createResponse) return
          router.push(`/dashboard/outreach/phone-banking/${createResponse.id}`)
          onClose()
        },
      }
    : stepId === 'who'
      ? audienceCta
      : stepId === 'script'
        ? {
            label: 'Continue',
            onClick: () => setStepId('sheets'),
            disabled:
              script.trim().length === 0 ||
              draftMutation.isPending ||
              name.trim().length === 0,
          }
        : stepId === 'sheets'
          ? {
              label: 'Continue',
              onClick: () => createMutation.mutate(),
              disabled: createMutation.isPending,
              loading: createMutation.isPending,
            }
          : null

  return (
    <OutreachFlowShell
      open={open}
      onClose={onClose}
      title={STEP_TITLES[stepId]}
      currentStep={stepIndex + 1}
      totalSteps={STEP_ORDER.length}
      onBack={stepIndex > 0 && !saved ? handleBack : undefined}
      cta={cta}
      dirty={dirty}
    >
      {stepId === 'purpose' ? (
        <PurposeStep selected={purpose} onSelect={handleSelectPurpose} />
      ) : stepId === 'who' ? (
        <>
          <OutreachAudienceStep
            channel="phoneBanking"
            copy={PHONE_BANKING_AUDIENCE_COPY}
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
      ) : stepId === 'script' ? (
        <ScriptStep
          name={name}
          onNameChange={(value) => {
            setName(value)
            setNameEdited(true)
          }}
          audienceLabel={audienceLabel}
          tone={tone}
          onToneChange={handleToneChange}
          script={script}
          onScriptChange={handleScriptChange}
          instructions={instructions}
          onInstructionsChange={setInstructions}
          onRegenerate={() =>
            requestDraft(purpose, tone, undefined, script.trim() || undefined)
          }
          onImprove={() => requestDraft(purpose, tone, script.trim())}
          canImprove={script.trim().length > 0 && !draftMutation.isPending}
          isDrafting={draftMutation.isPending}
          isDraftError={draftMutation.isError}
          isCustomPurpose={purpose === 'custom'}
        />
      ) : stepId === 'sheets' ? (
        <SheetCountStep
          sheetCount={sheetCount}
          onSheetCountChange={handleSheetCountChange}
          createErrorMessage={createErrorMessage}
          reachableCount={audience.reachableCount}
        />
      ) : saved && createResponse ? (
        <DownloadStep
          response={createResponse}
          audienceLabel={audienceLabel}
          reachableCount={audience.reachableCount}
        />
      ) : null}
    </OutreachFlowShell>
  )
}
