'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import type {
  PhoneBankingCreateResponse,
  PhoneBankingFilters,
  PhoneBankingPurpose,
  PhoneBankingScriptDraftRequest,
  SocialTone,
} from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { CheckCircleIcon } from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { extractApiErrorInfo } from 'helpers/extractApiErrorInfo'
import { AUTO_VOTER_FILTER_NAME_PATTERN } from 'app/dashboard/components/tasks/flows/util/flowHandlers.util'
import { OutreachFlowShell, type FlowShellCta } from '../OutreachFlowShell'
import { phoneBankingPurposeLabel } from '../phoneBankingPurposes'
import { PurposeStep } from './PurposeStep'
import {
  WhoStep,
  type PhoneBankingFilterState,
  type SavedPhoneBankingList,
} from './WhoStep'
import { ScriptStep } from './ScriptStep'
import { SheetCountStep } from './SheetCountStep'
import { DownloadStep } from './DownloadStep'

type StepId = 'purpose' | 'who' | 'script' | 'sheets' | 'download'
const STEP_ORDER: StepId[] = ['purpose', 'who', 'script', 'sheets', 'download']

const STEP_TITLES: Record<StepId, string> = {
  purpose: 'What do you want to do?',
  who: 'Who do you want to call?',
  script: 'What do you want to say?',
  sheets: 'How many sheets do you need?',
  download: 'Ready to build your call list',
}

const GENERIC_CREATE_ERROR_MESSAGE =
  "We couldn't create this call list. Try again."

interface PhoneBankingFlowProps {
  open: boolean
  onClose: () => void
}

// ENG-10918's route contract: a bare URL returns one PDF for a single-sheet
// list, or a ZIP of every sheet for a multi-sheet one; `?sheet=N` always
// returns just that sheet's PDF. So a multi-sheet list offers the ZIP link
// plus one link per sheet; a single-sheet list offers only the bare link.
const downloadLinksFor = (
  response: PhoneBankingCreateResponse,
): { href: string; label: string }[] => {
  const basePath = `/dashboard/outreach/phone-banking/print/${response.id}/pdf`
  if (response.sheetCount === 1) {
    return [{ href: basePath, label: 'Download call sheet (PDF)' }]
  }
  return [
    { href: basePath, label: 'Download all sheets (ZIP)' },
    ...Array.from({ length: response.sheetCount }, (_, i) => ({
      href: `${basePath}?sheet=${i + 1}`,
      label: `Sheet ${i + 1} (PDF)`,
    })),
  ]
}

const SuccessScreen = ({
  response,
  onDone,
}: {
  response: PhoneBankingCreateResponse
  onDone: () => void
}) => {
  const handleDownloadClick = () => {
    trackEvent(EVENTS.Outreach.PhoneBanking.SheetDownloaded, {
      listId: response.id,
      contactCount: response.personCount,
    })
  }

  return (
    <div className="space-y-6 py-8 text-center">
      <div className="flex justify-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary-light">
          <CheckCircleIcon className="size-8 text-primary" />
        </span>
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-foreground">
          Your call list is ready!
        </h2>
        <p className="text-muted-foreground">
          {response.personCount.toLocaleString()} people across{' '}
          {response.sheetCount} sheet{response.sheetCount === 1 ? '' : 's'}.
        </p>
      </div>
      <div className="space-y-2">
        {downloadLinksFor(response).map(({ href, label }) => (
          <Button
            key={href}
            asChild
            variant="secondary"
            className="w-full"
            onClick={handleDownloadClick}
          >
            {/* The PDF/ZIP is built by a route handler (ENG-10918) — a plain
                anchor, same precedent as door-knocking's print link. */}
            <a href={href} target="_blank" rel="noreferrer">
              {label}
            </a>
          </Button>
        ))}
      </div>
      <Button size="large" className="w-full" onClick={onDone}>
        Done
      </Button>
    </div>
  )
}

// Flow state is flat client state owned here (phase 1 TDD, same convention
// as SocialFlow): no server drafts — nothing persists until the final
// create call, and reopening starts fresh.
export const PhoneBankingFlow = ({ open, onClose }: PhoneBankingFlowProps) => {
  const [stepId, setStepId] = useState<StepId>('purpose')
  const [purpose, setPurpose] = useState<PhoneBankingPurpose | null>(null)
  const [selectedListId, setSelectedListId] = useState<number | null>(null)
  const [filters, setFilters] = useState<PhoneBankingFilterState>({})
  const [filterName, setFilterName] = useState('')
  const [tone, setTone] = useState<SocialTone>('warm')
  const [script, setScript] = useState('')
  const [manuallyEdited, setManuallyEdited] = useState(false)
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
        'POST /outreach/phone-banking/draft',
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
        selectedListId !== null
          ? { ...base, voterFileFilterId: selectedListId }
          : {
              ...base,
              // WhoStep's pill keys are exactly PhoneBankingFiltersSchema's
              // boolean field names (see WhoStep's PhoneBankingFilterState).
              filters: filters as PhoneBankingFilters,
              filterName: filterName.trim(),
            },
      )
      return data
    },
    onSuccess: (response) => {
      setCreateResponse(response)
      setSaved(true)
      trackEvent(EVENTS.Outreach.PhoneBanking.ListCreated, {
        product: 'phoneBanking',
        filtersApplied:
          selectedListId === null && Object.values(filters).some(Boolean),
        listSize: response.personCount,
      })
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
    setSelectedListId(null)
    setFilters({})
    setFilterName('')
    setTone('warm')
    setScript('')
    setManuallyEdited(false)
    setSheetCount(1)
    setName('')
    setNameEdited(false)
    setSaved(false)
    setCreateResponse(null)
    resetDraftMutation()
    resetCreateMutation()
  }, [open, resetDraftMutation, resetCreateMutation])

  const stepIndex = STEP_ORDER.indexOf(stepId)

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
          setManuallyEdited(false)
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
    setManuallyEdited(false)
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
    setManuallyEdited(true)
    if (draftMutation.isError) resetDraftMutation()
  }

  const handleBack = () => {
    const previous = STEP_ORDER[stepIndex - 1]
    if (previous) setStepId(previous)
  }

  const dirty =
    !saved &&
    (purpose !== null ||
      script.trim().length > 0 ||
      selectedListId !== null ||
      filterName.trim().length > 0 ||
      Object.values(filters).some(Boolean))

  const createErrorMessage = createMutation.isError
    ? (extractApiErrorInfo(
        createMutation.error instanceof FetchError
          ? createMutation.error.data
          : undefined,
      ).message ?? GENERIC_CREATE_ERROR_MESSAGE)
    : null

  const cta: FlowShellCta | null = saved
    ? null
    : stepId === 'who'
      ? {
          label: 'Continue',
          onClick: () => setStepId('script'),
          disabled: selectedListId === null && filterName.trim().length === 0,
        }
      : stepId === 'script'
        ? {
            label: 'Continue',
            onClick: () => setStepId('sheets'),
            disabled: script.trim().length === 0 || draftMutation.isPending,
          }
        : stepId === 'sheets'
          ? {
              label: 'Continue',
              onClick: () => {
                if (!nameEdited && purpose) {
                  setName(phoneBankingPurposeLabel(purpose))
                }
                setStepId('download')
              },
            }
          : stepId === 'download'
            ? {
                label: 'Create',
                onClick: () => createMutation.mutate(),
                disabled: createMutation.isPending || name.trim().length === 0,
                loading: createMutation.isPending,
              }
            : null

  return (
    <OutreachFlowShell
      open={open}
      onClose={onClose}
      title={saved ? 'Done' : STEP_TITLES[stepId]}
      currentStep={stepIndex + 1}
      totalSteps={saved ? 0 : STEP_ORDER.length}
      onBack={!saved && stepIndex > 0 ? handleBack : undefined}
      cta={cta}
      dirty={dirty}
    >
      {saved && createResponse ? (
        <SuccessScreen response={createResponse} onDone={onClose} />
      ) : stepId === 'purpose' ? (
        <PurposeStep selected={purpose} onSelect={handleSelectPurpose} />
      ) : stepId === 'who' ? (
        <WhoStep
          savedLists={savedListsQuery.data ?? []}
          selectedListId={selectedListId}
          onSelectList={setSelectedListId}
          filters={filters}
          onFiltersChange={setFilters}
          filterName={filterName}
          onFilterNameChange={setFilterName}
        />
      ) : stepId === 'script' ? (
        <ScriptStep
          tone={tone}
          onToneChange={handleToneChange}
          script={script}
          onScriptChange={handleScriptChange}
          onRegenerate={() => requestDraft(purpose, tone)}
          onImprove={() => requestDraft(purpose, tone, script.trim())}
          canImprove={manuallyEdited && script.trim().length > 0}
          isDrafting={draftMutation.isPending}
          isDraftError={draftMutation.isError}
          isCustomPurpose={purpose === 'custom'}
        />
      ) : stepId === 'sheets' ? (
        <SheetCountStep
          sheetCount={sheetCount}
          onSheetCountChange={setSheetCount}
        />
      ) : (
        <DownloadStep
          name={name}
          onNameChange={(value) => {
            setName(value)
            setNameEdited(true)
          }}
          sheetCount={sheetCount}
          createErrorMessage={createErrorMessage}
        />
      )}
    </OutreachFlowShell>
  )
}
