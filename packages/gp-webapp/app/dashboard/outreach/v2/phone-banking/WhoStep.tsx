'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PHONE_BANKING_FILTER_NAME_MAX_LENGTH } from '@goodparty_org/contracts'
import {
  Button,
  FilterPill,
  FilterPillGroup,
  Input,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@styleguide'
import { Loader2Icon } from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import filterSections from 'app/dashboard/contacts/[[...attr]]/components/configs/filters.config'
import { fetchListDetail } from 'app/dashboard/contacts/crm/lists/useListRowDetail'
import { Intro } from '../social/Intro'

const NEW_FROM_FILTERS = '__new__'
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

interface WhoStepProps {
  savedLists: SavedPhoneBankingList[]
  selectedListId: number | null
  onSelectList: (id: number | null) => void
  filters: PhoneBankingFilterState
  onFiltersChange: (filters: PhoneBankingFilterState) => void
  filterName: string
  onFilterNameChange: (name: string) => void
  // The saved-list reachability count is the only signal that can block
  // Continue — the inline-audience count failing is caught at create time by
  // the API's validation instead. Reported on every relevant change so the
  // parent's CTA can't advance past a count it knows failed.
  onCountStatusChange?: (status: { failed: boolean; pending: boolean }) => void
}

export const WhoStep = ({
  savedLists,
  selectedListId,
  onSelectList,
  filters,
  onFiltersChange,
  filterName,
  onFilterNameChange,
  onCountStatusChange,
}: WhoStepProps) => {
  const selectedList =
    selectedListId === null
      ? null
      : (savedLists.find((list) => list.id === selectedListId) ?? null)

  const listDetailQuery = useQuery({
    queryKey: ['phone-banking-who-list-detail', selectedListId],
    queryFn: () => fetchListDetail(selectedListId as number),
    enabled: selectedListId !== null,
  })

  const [debouncedFilters, setDebouncedFilters] = useState(filters)
  const [isDebouncing, setIsDebouncing] = useState(false)
  useEffect(() => {
    if (selectedListId !== null) return
    setIsDebouncing(true)
    const timeout = setTimeout(() => {
      setDebouncedFilters(filters)
      setIsDebouncing(false)
    }, COUNT_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [filters, selectedListId])

  const countQuery = useQuery({
    queryKey: ['phone-banking-who-count', debouncedFilters],
    queryFn: () =>
      clientRequest('POST /v1/contacts/count', { ...debouncedFilters }).then(
        (res) => res.data,
      ),
    enabled: selectedListId === null,
    refetchOnWindowFocus: false,
  })

  const selectedOptionsForField = (
    options: Array<{ key: string; label: string }>,
  ): string[] =>
    options.filter((option) => filters[option.key]).map((option) => option.key)

  const handleFieldValueChange = (
    options: Array<{ key: string; label: string }>,
    values: string[],
  ) => {
    const selected = new Set(values)
    const updated: PhoneBankingFilterState = { ...filters }
    options.forEach((option) => {
      updated[option.key] = selected.has(option.key)
    })
    onFiltersChange(updated)
  }

  const savedListCount = listDetailQuery.data?.reachability.phoneBanking ?? null
  const savedListCountFailed =
    listDetailQuery.isError || savedListCount === null

  // Mirrors the render order below (pending, then failed, then count) so the
  // parent's Continue gate can never advance past a count it hasn't actually
  // resolved.
  useEffect(() => {
    onCountStatusChange?.(
      selectedListId === null
        ? { failed: false, pending: false }
        : {
            failed: !listDetailQuery.isPending && savedListCountFailed,
            pending: listDetailQuery.isPending,
          },
    )
  }, [
    selectedListId,
    listDetailQuery.isPending,
    savedListCountFailed,
    onCountStatusChange,
  ])

  return (
    <div className="space-y-6">
      <Intro
        channel="phoneBanking"
        title="Who do you want to call?"
        body="Use a saved list, or build a new audience from your voter file."
      />

      {savedLists.length > 0 && (
        <Select
          value={
            selectedListId === null ? NEW_FROM_FILTERS : String(selectedListId)
          }
          onValueChange={(value) =>
            onSelectList(value === NEW_FROM_FILTERS ? null : Number(value))
          }
        >
          <SelectTrigger className="w-full justify-start">
            <Label className="border-r border-border pr-3 text-sm font-normal text-muted-foreground">
              Audience
            </Label>
            <div className="w-full pl-1 text-left">
              <SelectValue placeholder="Build a new audience" />
            </div>
          </SelectTrigger>
          <SelectContent className="max-h-[50vh]">
            <SelectItem value={NEW_FROM_FILTERS}>
              Build a new audience
            </SelectItem>
            <SelectGroup>
              <SelectLabel>Your saved lists</SelectLabel>
              {savedLists.map((list) => (
                <SelectItem key={list.id} value={String(list.id)}>
                  {list.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}

      {selectedList ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Using your saved list:{' '}
            <span className="font-semibold text-foreground">
              {selectedList.name}
            </span>
          </p>
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
      ) : (
        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="phone-banking-filter-name">List name</Label>
            <Input
              id="phone-banking-filter-name"
              value={filterName}
              maxLength={PHONE_BANKING_FILTER_NAME_MAX_LENGTH}
              placeholder="Name this audience"
              onChange={(e) => onFilterNameChange(e.target.value)}
            />
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

          <div className="text-sm">
            {countQuery.isPending || isDebouncing ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                Counting matching voters…
              </p>
            ) : countQuery.isError ? (
              <div className="flex items-center gap-3">
                <p className="text-destructive">
                  We couldn&apos;t count this audience. Try again.
                </p>
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  onClick={() => countQuery.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : (
              <p className="text-foreground">
                <span className="font-semibold">
                  {(countQuery.data?.count ?? 0).toLocaleString()}
                </span>{' '}
                matching voters
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
