'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import {
  PHONE_BANKING_FILTER_NAME_MAX_LENGTH,
  type PhoneBankingCreateResponse,
  type PhoneBankingFilters,
  type PhoneBankingPurpose,
  type PhoneBankingScriptDraftRequest,
  type SocialTone,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { extractApiErrorInfo } from 'helpers/extractApiErrorInfo'
import { AUTO_VOTER_FILTER_NAME_PATTERN } from 'app/dashboard/components/tasks/flows/util/flowHandlers.util'
import { OutreachFlowShell, type FlowShellCta } from '../OutreachFlowShell'
import { phoneBankingPurposeLabel } from '../phoneBankingPurposes'
import { PurposeStep } from './PurposeStep'
import {
  WhoStep,
  type BuilderCountStatus,
  type PhoneBankingFilterState,
  type SavedPhoneBankingList,
  type WhoAudienceSource,
  type WhoSubStep,
} from './WhoStep'
import { ScriptStep } from './ScriptStep'
import { SheetCountStep } from './SheetCountStep'
import { DownloadStep } from './DownloadStep'

type StepId = 'purpose' | 'who' | 'script' | 'sheets' | 'download'
const STEP_ORDER: StepId[] = ['purpose', 'who', 'script', 'sheets', 'download']

const STEP_TITLES: Record<StepId, string> = {
  purpose: 'What do you want to do?',
  who: 'Who are you calling?',
  script: 'Write your call script',
  sheets: 'How many lists would you like me to create?',
  download: 'Your call list is ready',
}

const GENERIC_CREATE_ERROR_MESSAGE =
  "We couldn't create this call list. Try again."

const EMPTY_BUILDER_COUNT_STATUS: BuilderCountStatus = {
  hasActiveFilter: false,
  pending: false,
  failed: false,
  count: null,
}

interface PhoneBankingFlowProps {
  open: boolean
  onClose: () => void
  onSaved?: (outreachId: number, name: string) => void
}

// Flow state is flat client state owned here (phase 1 TDD, same convention
// as SocialFlow): no server drafts — nothing persists until the final
// create call, and reopening starts fresh.
export const PhoneBankingFlow = ({
  open,
  onClose,
  onSaved,
}: PhoneBankingFlowProps) => {
  const router = useRouter()
  const [stepId, setStepId] = useState<StepId>('purpose')
  const [purpose, setPurpose] = useState<PhoneBankingPurpose | null>(null)

  // Who step: three audience sources (design canvas anatomy). `all` is the
  // default — the recommended, no-filter audience. `saved` carries
  // selectedListId; `custom` carries the committed builder output
  // (customFilters/customListName). whoSubStep tracks the picker's own
  // sub-flow (builder → naming) for the create-a-new-list path; it never
  // moves the shell's step stepper.
  const [audienceSource, setAudienceSource] = useState<WhoAudienceSource>('all')
  const [selectedListId, setSelectedListId] = useState<number | null>(null)
  const [whoSubStep, setWhoSubStep] = useState<WhoSubStep>('picker')
  const [customFilters, setCustomFilters] = useState<PhoneBankingFilterState>(
    {},
  )
  const [customListName, setCustomListName] = useState('')
  const [builderFilters, setBuilderFilters] = useState<PhoneBankingFilterState>(
    {},
  )
  const [builderName, setBuilderName] = useState('')
  const [listCountFailed, setListCountFailed] = useState(false)
  const [listCountPending, setListCountPending] = useState(false)
  const [builderCountStatus, setBuilderCountStatus] = useState(
    EMPTY_BUILDER_COUNT_STATUS,
  )

  const [tone, setTone] = useState<SocialTone>('warm')
  const [script, setScript] = useState('')
  const [sheetCount, setSheetCount] = useState(1)
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [saved, setSaved] = useState(false)
  const [createResponse, setCreateResponse] =
    useState<PhoneBankingCreateResponse | null>(null)

  // Guards against an out-of-order draft response (or one from a closed
  // flow) clobbering a newer draft — same convention as SocialFlow.
  const draftRequestRef = useRef(0)

  const savedListsQuery = useQuery({
    queryKey: ['phone-banking-saved-lists'],
    queryFn: () =>
      clientRequest('GET /v1/voters/voter-file/filters', {}).then(({ data }) =>
        (data || [])
          .filter(
            (list) =>
              typeof list.name === 'string' &&
              !AUTO_VOTER_FILTER_NAME_PATTERN.test(list.name),
          )
          .map(
            (list): SavedPhoneBankingList => ({
              id: list.id,
              name: list.name,
            }),
          ),
      ),
    enabled: open,
  })

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
      const base = {
        name: name.trim(),
        script: script.trim(),
        sheetCount,
        purpose: purpose as PhoneBankingPurpose,
      }
      const { data } = await clientRequest(
        'POST /v1/phone-banking/lists',
        audienceSource === 'saved' && selectedListId !== null
          ? { ...base, voterFileFilterId: selectedListId }
          : audienceSource === 'custom'
            ? {
                ...base,
                filters: customFilters as PhoneBankingFilters,
                filterName: customListName.trim(),
              }
            : // `all` — the default, recommended audience: an empty filter
              // object with no phoneBanking-specific gate. Verified against
              // PhoneBankingCreateSchema and the gp-api service: an empty
              // filters object is accepted, and a zero-phone audience 400s
              // (rendered inline) exactly like a narrow custom filter would.
              {
                ...base,
                filters: {} as PhoneBankingFilters,
                filterName: 'All voters',
              },
      )
      return data
    },
    onSuccess: (response) => {
      setCreateResponse(response)
      setSaved(true)
      setStepId('download')
      trackEvent(EVENTS.Outreach.PhoneBanking.ListCreated, {
        product: 'phoneBanking',
        filtersApplied:
          audienceSource === 'custom' &&
          Object.values(customFilters).some(Boolean),
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
    setAudienceSource('all')
    setSelectedListId(null)
    setWhoSubStep('picker')
    setCustomFilters({})
    setCustomListName('')
    setBuilderFilters({})
    setBuilderName('')
    setListCountFailed(false)
    setListCountPending(false)
    setBuilderCountStatus(EMPTY_BUILDER_COUNT_STATUS)
    setTone('warm')
    setScript('')
    setSheetCount(1)
    setName('')
    setNameEdited(false)
    setSaved(false)
    setCreateResponse(null)
    resetDraftMutation()
    resetCreateMutation()
  }, [open, resetDraftMutation, resetCreateMutation])

  const stepIndex = STEP_ORDER.indexOf(stepId)

  const selectedSavedList =
    audienceSource === 'saved'
      ? (savedListsQuery.data ?? []).find((list) => list.id === selectedListId)
      : undefined
  const audienceLabel =
    audienceSource === 'all'
      ? 'All voters'
      : audienceSource === 'saved'
        ? (selectedSavedList?.name ?? 'Saved list')
        : customListName

  // Requests an AI script draft for the given purpose/tone; with
  // currentDraft it polishes that text in place (Improve with AI) instead
  // of writing fresh — the one generated path allowed for the custom
  // purpose, mirroring SocialFlow's requestDraft.
  const requestDraft = (
    nextPurpose: PhoneBankingPurpose | null,
    nextTone: SocialTone,
    currentDraft?: string,
  ) => {
    if (!nextPurpose) return
    if (nextPurpose === 'custom' && currentDraft === undefined) return
    const requestId = ++draftRequestRef.current
    draftMutate(
      {
        purpose: nextPurpose,
        tone: nextTone,
        ...(currentDraft === undefined ? {} : { currentDraft }),
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
    requestDraft(purpose, nextTone)
  }

  const handleScriptChange = (value: string) => {
    setScript(value)
    if (draftMutation.isError) resetDraftMutation()
  }

  // Auto-suggests the campaign name from the purpose on entering the script
  // step — only while the user hasn't typed their own (nameEdited).
  useEffect(() => {
    if (stepId !== 'script') return
    if (nameEdited) return
    if (!purpose) return
    setName(phoneBankingPurposeLabel(purpose))
  }, [stepId, purpose, nameEdited])

  const handleSelectAll = () => {
    setAudienceSource('all')
    setSelectedListId(null)
  }

  const handleSelectSaved = (id: number) => {
    setAudienceSource('saved')
    setSelectedListId(id)
  }

  const handleEnterBuilder = () => {
    setWhoSubStep('builder')
  }

  const handleBuilderContinue = () => {
    setWhoSubStep('naming')
  }

  const handleNamingContinue = () => {
    setCustomFilters(builderFilters)
    setCustomListName(
      builderName.trim().slice(0, PHONE_BANKING_FILTER_NAME_MAX_LENGTH),
    )
    setAudienceSource('custom')
    setSelectedListId(null)
    setWhoSubStep('picker')
    setBuilderFilters({})
    setBuilderName('')
    setStepId('script')
  }

  const handleBack = () => {
    if (stepId === 'who') {
      if (whoSubStep === 'naming') {
        setWhoSubStep('builder')
        return
      }
      if (whoSubStep === 'builder') {
        setWhoSubStep('picker')
        setBuilderFilters({})
        setBuilderName('')
        return
      }
    }
    const previous = STEP_ORDER[stepIndex - 1]
    if (previous) setStepId(previous)
  }

  const handleCountStatusChange = useCallback(
    ({ failed, pending }: { failed: boolean; pending: boolean }) => {
      setListCountFailed(failed)
      setListCountPending(pending)
    },
    [],
  )

  const handleBuilderCountStatusChange = useCallback(
    (status: BuilderCountStatus) => setBuilderCountStatus(status),
    [],
  )

  const dirty =
    !saved &&
    (purpose !== null ||
      script.trim().length > 0 ||
      selectedListId !== null ||
      audienceSource === 'custom' ||
      Object.values(builderFilters).some(Boolean))

  const createErrorMessage = createMutation.isError
    ? (extractApiErrorInfo(
        createMutation.error instanceof FetchError
          ? createMutation.error.data
          : undefined,
      ).message ?? GENERIC_CREATE_ERROR_MESSAGE)
    : null

  const builderCtaLabel =
    builderCountStatus.hasActiveFilter &&
    !builderCountStatus.pending &&
    !builderCountStatus.failed &&
    builderCountStatus.count !== null
      ? `Continue (${builderCountStatus.count.toLocaleString()})`
      : 'Continue'

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
      ? whoSubStep === 'builder'
        ? {
            label: builderCtaLabel,
            onClick: handleBuilderContinue,
            disabled:
              !builderCountStatus.hasActiveFilter ||
              builderCountStatus.pending ||
              builderCountStatus.failed,
          }
        : whoSubStep === 'naming'
          ? {
              label: 'Continue',
              onClick: handleNamingContinue,
              disabled: builderName.trim().length === 0,
            }
          : {
              label: 'Continue',
              onClick: () => setStepId('script'),
              disabled:
                audienceSource === 'saved' &&
                (listCountFailed || listCountPending),
            }
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
        <WhoStep
          savedLists={savedListsQuery.data ?? []}
          audienceSource={audienceSource}
          selectedListId={selectedListId}
          customListName={customListName}
          onSelectAll={handleSelectAll}
          onSelectSaved={handleSelectSaved}
          subStep={whoSubStep}
          onEnterBuilder={handleEnterBuilder}
          builderFilters={builderFilters}
          onBuilderFiltersChange={setBuilderFilters}
          builderName={builderName}
          onBuilderNameChange={setBuilderName}
          onCountStatusChange={handleCountStatusChange}
          onBuilderCountStatusChange={handleBuilderCountStatusChange}
        />
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
          onRegenerate={() => requestDraft(purpose, tone)}
          onImprove={() => requestDraft(purpose, tone, script.trim())}
          canImprove={script.trim().length > 0 && !draftMutation.isPending}
          isDrafting={draftMutation.isPending}
          isDraftError={draftMutation.isError}
          isCustomPurpose={purpose === 'custom'}
        />
      ) : stepId === 'sheets' ? (
        <SheetCountStep
          sheetCount={sheetCount}
          onSheetCountChange={setSheetCount}
          createErrorMessage={createErrorMessage}
        />
      ) : saved && createResponse ? (
        <DownloadStep response={createResponse} audienceLabel={audienceLabel} />
      ) : null}
    </OutreachFlowShell>
  )
}
