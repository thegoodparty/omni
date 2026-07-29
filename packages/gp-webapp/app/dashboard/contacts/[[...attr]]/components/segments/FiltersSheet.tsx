'use client'
import Body2 from '@shared/typography/Body2'
import {
  Button,
  Checkbox,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetTitle,
} from '@styleguide'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useOrganization } from '@shared/organization-picker'
import { numberFormatter } from 'helpers/numberHelper'
import filterSections from '../configs/filters.config'
import { FiEdit } from 'react-icons/fi'
import { clientRequest } from 'gpApi/typed-request'
import { type SegmentResponse } from '../../../crm/shared/contacts-types'
import {
  INCOME_KEY_TO_RANGE,
  LANGUAGE_KEY_TO_CODE,
  transformVoterFileFiltersForBackend,
  type VoterFileFilters,
  type VoterFileBackendFilters,
} from '../../../crm/shared/voterFileFilterTransform.util'
import { useSnackbar } from 'helpers/useSnackbar'
import { useContactsTable } from '../../../crm/ContactsTableProvider'
import { SHEET_MODES } from '../../../crm/shared/constants'
import DeleteSegment from './DeleteSegment'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import {
  filterOnlyTrueValues,
  trimCustomSegmentName,
  MAX_SEGMENT_NAME_LENGTH,
} from '../../../crm/shared/segments.util'

type SheetMode = (typeof SHEET_MODES)[keyof typeof SHEET_MODES]

type Filters = VoterFileFilters
type BackendFilters = VoterFileBackendFilters

interface FiltersSheetProps {
  open: boolean
  handleClose: () => void
  mode: SheetMode
  editSegment: SegmentResponse | null
  handleOpenChange: (open: boolean) => void
  resetSelect: () => void
  afterSave: (segmentId: number) => void
}

const RANGE_TO_INCOME_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(INCOME_KEY_TO_RANGE).map(([k, v]) => [v, k]),
)

const LANGUAGE_KEYS = new Set(Object.keys(LANGUAGE_KEY_TO_CODE))
const INCOME_KEYS = new Set([
  ...Object.keys(INCOME_KEY_TO_RANGE),
  'incomeUnknown',
])

const ALL_FILTER_OPTION_KEYS = filterSections.flatMap((section) =>
  section.fields.flatMap((field) => field.options.map((opt) => opt.key)),
)

const transformFiltersFromBackend = (backend: BackendFilters): Filters => {
  const result: Filters = {}

  for (const key of ALL_FILTER_OPTION_KEYS) {
    if (LANGUAGE_KEYS.has(key) || INCOME_KEYS.has(key)) continue
    result[key] = !!backend[key]
  }

  const languageCodes = Array.isArray(backend.languageCodes)
    ? backend.languageCodes
    : []
  for (const [key, code] of Object.entries(LANGUAGE_KEY_TO_CODE)) {
    result[key] = languageCodes.includes(code)
  }

  const incomeRanges = Array.isArray(backend.incomeRanges)
    ? backend.incomeRanges
    : []
  for (const key of Object.keys(INCOME_KEY_TO_RANGE)) {
    result[key] = false
  }
  for (const range of incomeRanges) {
    const key = RANGE_TO_INCOME_KEY[range]
    if (key) result[key] = true
  }
  result.incomeUnknown = !!backend.incomeUnknown

  return result
}

// True when a backend filter payload selects anything (a true flag, a
// non-empty array, or a search). Reads the debounced payload so the count
// query's enabled gate and its sent payload stay in lockstep.
const payloadHasCriteria = (payload: BackendFilters): boolean =>
  Object.entries(payload).some(([key, value]) => {
    if (key === 'search') return typeof value === 'string' && value.length > 0
    if (Array.isArray(value)) return value.length > 0
    return value === true
  })

export default function Filters({
  open = false,
  handleClose,
  mode,
  editSegment,
  handleOpenChange,
  resetSelect,
  afterSave,
}: FiltersSheetProps) {
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const [filters, setFilters] = useState<Filters>({})
  const [isEditingName, setIsEditingName] = useState(false)
  const [segmentName, setSegmentName] = useState('')
  const {
    customSegments,
    refreshCustomSegments,
    selectSegment,
    isElectedOfficial,
    isWinContext,
    searchTerm,
  } = useContactsTable()

  // A list created while a search is active saves that search so selecting it
  // later reproduces the searched-down result set, even with no filters picked
  // (ENG-10518). Only relevant in create mode — editing a saved list keeps its
  // own persisted search untouched.
  const createSearch = mode === SHEET_MODES.CREATE ? searchTerm.trim() : ''

  // Org-scoped like every other contacts query (ENG-10511) so a count can't
  // leak across orgs when the active org changes outside the picker.
  const orgSlug = useOrganization()?.slug

  // The backend filter set the count reflects: the same payload the list would
  // save, including any active search the create flow carries (ENG-10517).
  const countPayload = useMemo(
    () => ({
      ...transformVoterFileFiltersForBackend(filters),
      ...(createSearch ? { search: createSearch } : {}),
    }),
    [filters, createSearch],
  )

  // Debounce the payload that drives the count query so rapid checkbox toggling
  // doesn't fire a request per click (mirrors the search box's debounce). The
  // query is keyed on this debounced value, so React Query dedupes + caches per
  // distinct filter set.
  const [debouncedPayload, setDebouncedPayload] = useState(countPayload)
  const countTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (countTimeoutRef.current) clearTimeout(countTimeoutRef.current)
    countTimeoutRef.current = setTimeout(() => {
      setDebouncedPayload(countPayload)
    }, 600)
    return () => {
      if (countTimeoutRef.current) clearTimeout(countTimeoutRef.current)
    }
  }, [countPayload])

  // Whether the current selection defines any set worth counting. The on-screen
  // prompt reads this live; the query's enabled flag reads the debounced payload
  // so a request never fires with a payload that lags behind its own gate.
  const hasAnyFilter =
    Object.values(filters).some((value) => value === true) || !!createSearch

  const debouncedHasFilter = payloadHasCriteria(debouncedPayload)

  const countQuery = useQuery({
    queryKey: ['contacts-count', orgSlug, debouncedPayload],
    queryFn: () =>
      clientRequest('POST /v1/contacts/count', debouncedPayload).then(
        (res) => res.data.count,
      ),
    enabled: open && debouncedHasFilter,
    // The count is an at-a-glance affordance while editing; a window-focus
    // refetch mid-edit would be disruptive and waste a query.
    refetchOnWindowFocus: false,
  })

  const displayFilterSections = useMemo(
    () =>
      isElectedOfficial
        ? filterSections.map((section) => ({
            ...section,
            fields: section.fields.filter(
              (field) =>
                field.key !== 'political_party' &&
                field.key !== 'contacts_made',
            ),
          }))
        : filterSections,
    [isElectedOfficial],
  )

  useEffect(() => {
    if (mode === SHEET_MODES.EDIT && editSegment) {
      setFilters(transformFiltersFromBackend(editSegment))
      setSegmentName(editSegment.name || '')
      setIsEditingName(false)
    } else {
      const nextCustomSegmentName = `Custom Segment ${
        (customSegments.length || 0) + 1
      }`
      setFilters({})
      setSegmentName(nextCustomSegmentName)
      setIsEditingName(false)
    }
    // Seed the default name once when the sheet opens; a background
    // customSegments refetch (e.g. window-focus) must not overwrite a
    // name the user has already typed into the create input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, editSegment, open])

  const saveMutation = useMutation({
    mutationFn: async (payload: { name: string } & BackendFilters) =>
      clientRequest('POST /v1/voters/voter-file/filter', payload).then(
        (res) => res.data,
      ),
    onSuccess: async (response) => {
      successSnackbar('Segment created successfully')
      trackEvent(EVENTS.Contacts.SegmentCreated, {
        filters: filterOnlyTrueValues(filters),
        context: isWinContext ? 'win' : 'serve',
      })
      await refreshCustomSegments()
      afterSave(response.id)
      handleClose()
    },
    onError: async () => {
      errorSnackbar('Failed to create segment')
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: { id: number; name: string } & BackendFilters) =>
      clientRequest('PUT /v1/voters/voter-file/filter/:id', {
        id: String(id),
        ...payload,
      }).then((res) => res.data),
    onSuccess: async (_data, variables) => {
      successSnackbar('Segment updated successfully')
      trackEvent(EVENTS.Contacts.SegmentUpdated, {
        filters: filterOnlyTrueValues(filters),
        context: isWinContext ? 'win' : 'serve',
      })
      await refreshCustomSegments()
      selectSegment(variables.id.toString())
      handleClose()
    },
    onError: async () => {
      errorSnackbar('Failed to update segment')
    },
  })

  const isSaving = saveMutation.isPending || updateMutation.isPending

  const handleCheckedChange = (checked: boolean, key: string) => {
    setFilters({ ...filters, [key]: checked })
  }

  const handleSelectAll = (options: Array<{ key: string; label: string }>) => {
    const updatedFilters = { ...filters }
    options.forEach((option) => {
      updatedFilters[option.key] = true
    })

    setFilters(updatedFilters)
  }

  const handleSave = () => {
    if (!canSave()) {
      errorSnackbar('Please select at least one filter')
      return
    }
    saveMutation.mutate({
      name: segmentName.trim(),
      ...transformVoterFileFiltersForBackend(filters),
      ...(createSearch ? { search: createSearch } : {}),
    })
  }

  const handleUpdate = () => {
    if (!canSave() || !editSegment) {
      if (!canSave()) errorSnackbar('Please select at least one filter')
      return
    }
    updateMutation.mutate({
      id: editSegment.id,
      name: segmentName.trim(),
      ...transformVoterFileFiltersForBackend(filters),
    })
  }

  const handleAfterDelete = () => {
    handleClose()
    resetSelect()
  }

  const canSave = (): boolean => {
    if (!segmentName.trim()) return false
    // A search-derived list is valid with no filters: the saved search alone
    // defines it (ENG-10518). Otherwise at least one filter is required.
    if (createSearch) return true
    return Object.values(filters).some((value) => value === true)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTitle className="sr-only"> Filters </SheetTitle>
      <SheetContent className="w-[90vw] max-w-xl sm:max-w-xl  h-full overflow-y-auto p-4 lg:p-8 z-[1301]">
        <div className="pb-6 border-b border-gray-200">
          {mode === SHEET_MODES.CREATE ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="segment-name">List name</Label>
              <Input
                id="segment-name"
                value={segmentName}
                onChange={(e) =>
                  setSegmentName(
                    e.target.value.slice(0, MAX_SEGMENT_NAME_LENGTH),
                  )
                }
                maxLength={MAX_SEGMENT_NAME_LENGTH}
                placeholder="Name your list"
              />
              {createSearch && (
                <Body2 className="text-muted-foreground">
                  Saving your current search “{createSearch}”. Add filters below
                  to narrow it further, or save as is.
                </Body2>
              )}
            </div>
          ) : (
            <div className="flex items-center">
              {isEditingName ? (
                <Input
                  value={segmentName}
                  onChange={(e) =>
                    setSegmentName(
                      e.target.value.slice(0, MAX_SEGMENT_NAME_LENGTH),
                    )
                  }
                  onBlur={() => setIsEditingName(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setIsEditingName(false)
                    }
                  }}
                  autoFocus
                  maxLength={MAX_SEGMENT_NAME_LENGTH}
                />
              ) : (
                <>
                  <h2 className="text-3xl lg:text-4xl font-semibold ">
                    {trimCustomSegmentName(segmentName)}
                  </h2>
                  <FiEdit
                    className="text-2xl ml-4 cursor-pointer"
                    onClick={() => setIsEditingName(true)}
                  />
                </>
              )}
            </div>
          )}
        </div>

        {displayFilterSections.map((section, index) => (
          <div key={section.title} className="mt-4">
            <h3 className="text-xl lg:text-2xl font-semibold">
              {section.title}
            </h3>
            {section.fields.map((field) => (
              <div key={field.key} className="mt-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-medium text-gray-600">
                    {field.label}
                  </h4>
                  <div
                    className="text-xs font-semibold cursor-pointer text-blue-500"
                    onClick={() => handleSelectAll(field.options)}
                  >
                    Select All
                  </div>
                </div>
                {field.options.map((option) => (
                  <div key={option.key} className="mt-2 flex items-center ">
                    <Checkbox
                      checked={filters[option.key] ?? false}
                      onCheckedChange={(checked) => {
                        handleCheckedChange(checked === true, option.key)
                      }}
                    />
                    <Body2 className="font-medium ml-2">{option.label}</Body2>
                  </div>
                ))}
              </div>
            ))}

            {index === displayFilterSections.length - 1 && (
              <>
                {mode === SHEET_MODES.EDIT && editSegment && (
                  <DeleteSegment
                    segment={editSegment}
                    afterDeleteCallback={handleAfterDelete}
                  />
                )}
                <div className="h-20 "></div>
              </>
            )}
          </div>
        ))}

        <div className="fixed bottom-0 bg-white shadow-sm p-4 flex justify-between items-center gap-4 w-[90vw] max-w-xl sm:max-w-xl right-0 border-t border-gray-200">
          <Body2 className="text-muted-foreground" aria-live="polite">
            {!hasAnyFilter
              ? 'Select a filter to see matching voters'
              : countQuery.isError
                ? 'Could not load count'
                : countQuery.isPending || countQuery.isFetching
                  ? 'Counting voters…'
                  : `${numberFormatter(countQuery.data)} voters match`}
          </Body2>
          <div className="flex gap-4">
            <Button variant="outline" onClick={() => setFilters({})}>
              Clear Filters
            </Button>
            <Button
              variant="default"
              onClick={mode === SHEET_MODES.EDIT ? handleUpdate : handleSave}
              disabled={isSaving || !canSave()}
            >
              {mode === SHEET_MODES.EDIT ? 'Update Segment' : 'Create Segment'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
