'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PHONE_BANKING_FILTER_NAME_MAX_LENGTH } from '@goodparty_org/contracts'
import {
  Button,
  Card,
  cn,
  FilterPill,
  FilterPillGroup,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@styleguide'
import {
  CheckIcon,
  ChevronDownIcon,
  FilterIcon,
  Loader2Icon,
  PlusIcon,
  SparklesIcon,
} from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import filterSections from 'app/dashboard/contacts/[[...attr]]/components/configs/filters.config'
import { fetchListDetail } from 'app/dashboard/contacts/crm/lists/useListRowDetail'
import { Intro } from '../social/Intro'

// Debounce mirrors the CRM wizard's live-count pattern
// (useListWizardCount.ts) — no fenced-count retry exists server-side, so a
// large selection either returns or the request errors within people-db's
// 25s statement timeout.
const COUNT_DEBOUNCE_MS = 600

// Only the filter dimensions PhoneBankingFiltersSchema exposes (contracts):
// voter likelihood, political party, cell phone, landline. The option keys
// below are exactly that schema's field names, so the pill state doubles as
// the create-request `filters` payload with no transform.
const WHO_STEP_FIELD_KEYS = [
  'voter_likely',
  'political_party',
  'cell_phone',
  'landline',
]
const WHO_STEP_FIELDS = filterSections
  .flatMap((section) => section.fields)
  .filter((field) => WHO_STEP_FIELD_KEYS.includes(field.key))

export type WhoAudienceSource = 'all' | 'saved' | 'custom'
export type WhoSubStep = 'picker' | 'builder' | 'naming'

export interface SavedPhoneBankingList {
  id: number
  name?: string
}

// A plain string-keyed record rather than the contracts `PhoneBankingFilters`
// type: that type's `search` field carries a different value type than the
// boolean pills below, so a generic `keyof`-indexed write against it can't
// type-check. The keys here are exactly PhoneBankingFiltersSchema's boolean
// field names (see WHO_STEP_FIELD_KEYS), so PhoneBankingFlow sends this
// object as-is for the `filters` request field.
export type PhoneBankingFilterState = Record<string, boolean>

export interface BuilderCountStatus {
  hasActiveFilter: boolean
  pending: boolean
  failed: boolean
  count: number | null
}

interface WhoStepProps {
  savedLists: SavedPhoneBankingList[]
  audienceSource: WhoAudienceSource
  selectedListId: number | null
  audienceLabel: string
  onSelectAll: () => void
  onSelectSaved: (id: number) => void
  subStep: WhoSubStep
  onEnterBuilder: () => void
  builderFilters: PhoneBankingFilterState
  onBuilderFiltersChange: (filters: PhoneBankingFilterState) => void
  builderName: string
  onBuilderNameChange: (name: string) => void
  // The saved-list reachability count is the only signal that can block
  // Continue on the picker sub-step — the inline-audience (custom) count
  // failing is caught at create time by the API's validation instead.
  // Reported on every relevant change so the parent's CTA can't advance past
  // a count it knows failed.
  onCountStatusChange?: (status: { failed: boolean; pending: boolean }) => void
  onBuilderCountStatusChange?: (status: BuilderCountStatus) => void
}

export const WhoStep = ({
  savedLists,
  audienceSource,
  selectedListId,
  audienceLabel,
  onSelectAll,
  onSelectSaved,
  subStep,
  onEnterBuilder,
  builderFilters,
  onBuilderFiltersChange,
  builderName,
  onBuilderNameChange,
  onCountStatusChange,
  onBuilderCountStatusChange,
}: WhoStepProps) => {
  const [popoverOpen, setPopoverOpen] = useState(false)

  const selectedList =
    audienceSource === 'saved' && selectedListId !== null
      ? (savedLists.find((list) => list.id === selectedListId) ?? null)
      : null

  const listDetailQuery = useQuery({
    queryKey: ['phone-banking-who-list-detail', selectedListId],
    queryFn: () => fetchListDetail(selectedListId as number),
    enabled: selectedListId !== null && audienceSource === 'saved',
  })

  // "All voters" reachable count — fetched once on mount for the recommended
  // card and mirrored on the "All lists" trigger when that's the active
  // selection. An error here never blocks the step (contacts/count backs the
  // create-time validation too), so it's just omitted on failure.
  const allVotersCountQuery = useQuery({
    queryKey: ['phone-banking-who-all-voters-count'],
    queryFn: () =>
      clientRequest('POST /v1/contacts/count', {}).then((res) => res.data),
    refetchOnWindowFocus: false,
  })

  const [debouncedBuilderFilters, setDebouncedBuilderFilters] =
    useState(builderFilters)
  const [isDebouncing, setIsDebouncing] = useState(false)
  useEffect(() => {
    if (subStep !== 'builder') return
    setIsDebouncing(true)
    const timeout = setTimeout(() => {
      setDebouncedBuilderFilters(builderFilters)
      setIsDebouncing(false)
    }, COUNT_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [builderFilters, subStep])

  // Without this, the count query fires on mount with an empty filter body
  // and shows the full voter-file count as if it meant something before the
  // user has chosen any filter.
  const hasActiveBuilderFilter = Object.values(debouncedBuilderFilters).some(
    Boolean,
  )

  const builderCountQuery = useQuery({
    queryKey: ['phone-banking-who-builder-count', debouncedBuilderFilters],
    queryFn: () =>
      clientRequest('POST /v1/contacts/count', {
        ...debouncedBuilderFilters,
      }).then((res) => res.data),
    enabled: subStep === 'builder' && hasActiveBuilderFilter,
    refetchOnWindowFocus: false,
  })

  const selectedOptionsForField = (
    options: Array<{ key: string; label: string }>,
  ): string[] =>
    options
      .filter((option) => builderFilters[option.key])
      .map((option) => option.key)

  const handleFieldValueChange = (
    options: Array<{ key: string; label: string }>,
    values: string[],
  ) => {
    const selected = new Set(values)
    const updated: PhoneBankingFilterState = { ...builderFilters }
    options.forEach((option) => {
      updated[option.key] = selected.has(option.key)
    })
    onBuilderFiltersChange(updated)
  }

  const savedListCount = listDetailQuery.data?.reachability.phoneBanking ?? null
  const savedListCountFailed =
    listDetailQuery.isError || savedListCount === null

  // Mirrors the render order below (pending, then failed, then count) so the
  // parent's Continue gate can never advance past a count it hasn't actually
  // resolved.
  useEffect(() => {
    onCountStatusChange?.(
      audienceSource !== 'saved' || selectedListId === null
        ? { failed: false, pending: false }
        : {
            failed: !listDetailQuery.isPending && savedListCountFailed,
            pending: listDetailQuery.isPending,
          },
    )
  }, [
    audienceSource,
    selectedListId,
    listDetailQuery.isPending,
    savedListCountFailed,
    onCountStatusChange,
  ])

  useEffect(() => {
    onBuilderCountStatusChange?.({
      hasActiveFilter: hasActiveBuilderFilter,
      pending: builderCountQuery.isPending || isDebouncing,
      failed: builderCountQuery.isError,
      count: builderCountQuery.data?.count ?? null,
    })
  }, [
    hasActiveBuilderFilter,
    builderCountQuery.isPending,
    builderCountQuery.isError,
    builderCountQuery.data,
    isDebouncing,
    onBuilderCountStatusChange,
  ])

  if (subStep === 'naming') {
    return (
      <div className="space-y-6">
        <Intro
          channel="phoneBanking"
          title="Name your list"
          body="You can rename it any time."
        />
        <div className="space-y-2">
          <Label htmlFor="phone-banking-list-name">List name</Label>
          <Input
            id="phone-banking-list-name"
            value={builderName}
            onChange={(e) => onBuilderNameChange(e.target.value)}
            placeholder="Name this list"
            maxLength={PHONE_BANKING_FILTER_NAME_MAX_LENGTH}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            {builderName.length}/{PHONE_BANKING_FILTER_NAME_MAX_LENGTH}
          </p>
        </div>
      </div>
    )
  }

  if (subStep === 'builder') {
    return (
      <div className="space-y-6">
        <Intro
          channel="phoneBanking"
          title="Build a voter list"
          body="Pick filters to define who this campaign reaches."
        />
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
              Filters
            </h4>
            {hasActiveBuilderFilter && (
              <Button
                type="button"
                variant="link"
                size="small"
                className="h-auto px-0"
                onClick={() => onBuilderFiltersChange({})}
              >
                Clear filters
              </Button>
            )}
          </div>
          {WHO_STEP_FIELDS.map((field) => (
            <div key={field.key} className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                {field.label}
              </h4>
              <FilterPillGroup
                type="multiple"
                value={selectedOptionsForField(field.options)}
                onValueChange={(values) =>
                  handleFieldValueChange(field.options, values)
                }
                aria-label={field.label}
              >
                {field.options.map((option) => (
                  <FilterPill key={option.key} value={option.key}>
                    {option.label}
                  </FilterPill>
                ))}
              </FilterPillGroup>
            </div>
          ))}
        </div>

        <div className="text-sm">
          {!hasActiveBuilderFilter ? (
            <p className="text-muted-foreground">
              Select at least one filter to see how many voters match.
            </p>
          ) : builderCountQuery.isPending || isDebouncing ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Counting matching voters…
            </p>
          ) : builderCountQuery.isError ? (
            <div className="flex items-center gap-3">
              <p className="text-destructive">
                We couldn&apos;t count this audience. Try again.
              </p>
              <Button
                type="button"
                size="small"
                variant="secondary"
                onClick={() => builderCountQuery.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : (
            <p className="text-foreground">
              <span className="font-semibold">
                {(builderCountQuery.data?.count ?? 0).toLocaleString()}
              </span>{' '}
              matching voters
            </p>
          )}
        </div>
      </div>
    )
  }

  const allSelected = audienceSource === 'all'
  const allVotersCount = allVotersCountQuery.data?.count ?? null

  const triggerSubtitle =
    audienceSource === 'all'
      ? allVotersCountQuery.isPending
        ? null
        : allVotersCount !== null
          ? `Reach ${allVotersCount.toLocaleString()} voters`
          : null
      : audienceSource === 'saved'
        ? 'Saved list'
        : 'Custom list'

  return (
    <div className="space-y-6">
      <Intro
        channel="phoneBanking"
        title="Who are you calling?"
        body="We recommend reaching all voters to increase awareness."
      />

      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase text-primary">
          <SparklesIcon className="size-3.5" />
          Recommended list
        </p>
        <Card
          role="button"
          tabIndex={0}
          onClick={onSelectAll}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelectAll()
            }
          }}
          className={cn(
            'cursor-pointer flex-row items-center justify-between gap-3 rounded-lg p-4 transition-colors',
            allSelected ? 'border-primary' : 'hover:border-primary/50',
          )}
        >
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">All voters</p>
            {allVotersCountQuery.isPending ? (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2Icon className="size-3 animate-spin" />
              </p>
            ) : allVotersCount !== null ? (
              <p className="truncate text-sm text-muted-foreground">
                Reach {allVotersCount.toLocaleString()} voters
              </p>
            ) : null}
          </div>
          {allSelected && (
            <CheckIcon className="size-5 shrink-0 text-primary" />
          )}
        </Card>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
          All lists
        </h4>
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Card
              role="button"
              tabIndex={0}
              aria-label="All lists"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setPopoverOpen(!popoverOpen)
                }
              }}
              className="cursor-pointer flex-row items-center justify-between gap-3 rounded-lg p-4"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {audienceLabel}
                </p>
                {triggerSubtitle && (
                  <p className="truncate text-sm text-muted-foreground">
                    {triggerSubtitle}
                  </p>
                )}
              </div>
              <ChevronDownIcon
                className={cn(
                  'size-5 shrink-0 text-muted-foreground transition-transform',
                  popoverOpen && 'rotate-180',
                )}
              />
            </Card>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={4}
            className="max-h-80 w-[var(--radix-popover-trigger-width)] overflow-y-auto p-0"
          >
            <div className="divide-y divide-border">
              <button
                type="button"
                onClick={() => {
                  onEnterBuilder()
                  setPopoverOpen(false)
                }}
                className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-light">
                  <PlusIcon className="size-4 text-primary" />
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-primary">
                    Create a new list
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    Build a custom audience
                  </span>
                </span>
              </button>
              {savedLists.map((list) => {
                const on =
                  audienceSource === 'saved' && list.id === selectedListId
                return (
                  <button
                    key={list.id}
                    type="button"
                    onClick={() => {
                      onSelectSaved(list.id)
                      setPopoverOpen(false)
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-muted',
                      on && 'bg-muted',
                    )}
                  >
                    <span className="min-w-0 truncate font-medium text-foreground">
                      {list.name}
                    </span>
                    {on && (
                      <CheckIcon className="size-5 shrink-0 text-primary" />
                    )}
                  </button>
                )
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {selectedList && (
        <div className="space-y-2 text-sm">
          {listDetailQuery.isPending ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Counting reachable voters…
            </p>
          ) : savedListCountFailed ? (
            <div className="flex items-center gap-3">
              <p className="text-destructive">
                We couldn&apos;t count this list. Try again.
              </p>
              <Button
                type="button"
                size="small"
                variant="secondary"
                onClick={() => listDetailQuery.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : (
            <p className="text-foreground">
              <span className="font-semibold">
                {(savedListCount ?? 0).toLocaleString()}
              </span>{' '}
              reachable by phone banking
            </p>
          )}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <FilterIcon className="size-4 shrink-0" />
        The number of reachable voters in each list may change based on the mode
        of outreach you select.
      </p>
    </div>
  )
}
