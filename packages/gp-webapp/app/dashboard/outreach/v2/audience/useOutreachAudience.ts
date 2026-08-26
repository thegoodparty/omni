import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ListDetailReachability } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { useElectedOffice } from '@shared/hooks/useElectedOffice'
import { useOrganization } from '@shared/organization-picker'
import { fetchListDetailThrottled } from 'app/dashboard/contacts/crm/lists/useListRowDetail'
import { AUTO_VOTER_FILTER_NAME_PATTERN } from 'app/dashboard/components/tasks/flows/util/flowHandlers.util'
import type {
  SegmentResponse,
  SupportStatusRollup,
} from 'app/dashboard/contacts/crm/shared/contacts-types'
import {
  transformVoterFileFiltersForBackend,
  type VoterFileFilters,
} from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import {
  usePrecinctOptions,
  type PrecinctOptionsResult,
} from 'app/dashboard/contacts/crm/wizard/usePrecinctOptions'
import { useListWizardCount } from 'app/dashboard/contacts/crm/wizard/useListWizardCount'
import type { OutreachAudienceMode } from './OutreachAudienceStep'

// The reachability leaf that matches the feature's channel: SMS/polls read the
// cell-phone count, robocall/phoneBanking the landline count, doorKnocking the
// address count. The list-detail endpoint computes each server-side, so a
// feature only names its leaf — it never re-derives the overlay for a saved
// list. `polls` is excluded: it isn't an outreach audience target.
export type ReachabilityKey = keyof Omit<ListDetailReachability, 'polls'>

// The saved-lists query key, exported as the single source of truth so the CRM
// list mutations (rename/delete/duplicate) can invalidate it alongside their own
// `custom-segments` key — both are backed by GET /v1/voters/voter-file/filters,
// so a stale name/deleted/duplicated list must not linger in this picker. A
// shared helper (vs. a re-typed string) keeps the two in sync if the key changes.
export const outreachAudienceListsKey = (orgSlug: string | undefined) =>
  ['outreach-audience-lists', orgSlug] as const

interface UseOutreachAudienceParams {
  open: boolean
  // stepId === 'audience' — gates the debounced builder count so it doesn't
  // run on steps that don't show it.
  active: boolean
  reachabilityKey: ReachabilityKey
  // The channel's reachability overlay applied to the in-flow BUILDER count so
  // the running total matches what the feature will actually reach (robocall:
  // { hasLandline: true }). It is deliberately NOT written into the saved list
  // — the list stays general so other features can reuse it; the overlay (and
  // the equivalent server-side reachability leaf) re-applies per send.
  countOverlay?: Record<string, unknown>
}

export interface OutreachAudience {
  mode: OutreachAudienceMode
  setMode: (mode: OutreachAudienceMode) => void
  selectedListId: number | null
  lists: SegmentResponse[]
  listsLoading: boolean
  selectedList: SegmentResponse | null
  reachableCount: number | null
  reachableLoading: boolean
  builderFilters: VoterFileFilters
  setBuilderFilters: (filters: VoterFileFilters) => void
  builderSupportStatus: SupportStatusRollup[]
  setBuilderSupportStatus: (value: SupportStatusRollup[]) => void
  builderPrecincts: string[]
  setBuilderPrecincts: (value: string[]) => void
  precinctOptions: PrecinctOptionsResult
  builderName: string
  setBuilderName: (name: string) => void
  // Whether the campaign is an elected official: gates party/voter-likely
  // filter pills in the builder. Resolved here so every consuming feature
  // gets the gate right without re-wiring it (VoterFileStep is dumb).
  isElectedOfficial: boolean
  builderCount: number | undefined
  builderCounting: boolean
  builderCapError: boolean
  builderCountErrorMessage: string | undefined
  // Settled-zero: the only count state that should block advancing.
  builderZeroMatch: boolean
  onSelect: (id: number) => void
  startBuilder: () => void
  // Persist the built filters as a saved list (overlay-free), refresh the
  // picker, and return the created row so the flow can select it.
  createList: () => Promise<SegmentResponse>
  createListPending: boolean
  createListError: boolean
  // Clears a failed-create error without touching the built filters — for the
  // name -> filters Back path, so a stale error can't re-flash on re-entry.
  clearCreateError: () => void
  resetBuilder: () => void
  // Full reset for flow open.
  reset: () => void
}

export const useOutreachAudience = ({
  open,
  active,
  reachabilityKey,
  countOverlay,
}: UseOutreachAudienceParams): OutreachAudience => {
  const [mode, setMode] = useState<OutreachAudienceMode>('picker')
  const [selectedListId, setSelectedListId] = useState<number | null>(null)
  const [builderFilters, setBuilderFilters] = useState<VoterFileFilters>({})
  const [builderSupportStatus, setBuilderSupportStatus] = useState<
    SupportStatusRollup[]
  >([])
  const [builderPrecincts, setBuilderPrecincts] = useState<string[]>([])
  const [builderName, setBuilderName] = useState('')

  const { data: electedOffice } = useElectedOffice()
  const isElectedOfficial = !!electedOffice
  // Same gating as the builder's count below: the flow host stays mounted, so
  // an ungated fetch would run for every outreach page view. 'picker' mode
  // shows saved lists only — the precinct control cannot render until the
  // builder is open on its filters step.
  const precinctOptions = usePrecinctOptions(
    open && active && mode !== 'picker' && !isElectedOfficial,
  )

  // Scope the saved-lists cache by org: with staleTime 0 the cached entry is
  // still served during an in-flight refetch, so an unscoped key would briefly
  // surface a prior org's lists after an org switch (matches the CRM callers'
  // ['custom-segments', orgSlug] scoping).
  const orgSlug = useOrganization()?.slug
  const queryClient = useQueryClient()

  const listsQuery = useQuery({
    queryKey: outreachAudienceListsKey(orgSlug),
    queryFn: async () => {
      const { data } = await clientRequest(
        'GET /v1/voters/voter-file/filters',
        {},
      )
      return (data ?? []).filter(
        (list): list is SegmentResponse =>
          typeof list?.name === 'string' &&
          !AUTO_VOTER_FILTER_NAME_PATTERN.test(list.name),
      )
    },
    enabled: open,
    // A list created in the CRM tab (or by the builder here) must appear on
    // return — bypass the app's default staleTime.
    staleTime: 0,
    refetchOnWindowFocus: true,
  })
  const lists = useMemo(() => listsQuery.data ?? [], [listsQuery.data])
  const selectedList = lists.find((l) => l.id === selectedListId) ?? null

  const reachabilityQuery = useQuery({
    queryKey: [
      'outreach-audience-reachability',
      orgSlug,
      reachabilityKey,
      selectedListId,
    ],
    queryFn: async ({ signal }) => {
      // Guarded by `enabled` below; narrow rather than cast so a future change
      // to the enable condition can't silently pass null through.
      if (selectedListId === null) throw new Error('No list selected')
      const detail = await fetchListDetailThrottled(selectedListId, signal)
      return detail.reachability[reachabilityKey]
    },
    // Gate on `active` (like the builder count): selectedListId persists onto
    // later steps, so without it every window-focus on a post-audience step
    // would refetch under staleTime:0 and burn a MAX_IN_FLIGHT list-detail slot.
    enabled: open && active && selectedListId !== null,
    // Refetch on every (re)selection so the isFetching-driven spinner below
    // actually fires: under the app's 5-min default staleTime a re-picked list
    // is still "fresh", no background refetch runs, isFetching stays false, and
    // a stale count would render with no loading state (matches listsQuery).
    staleTime: 0,
  })
  const reachableCount = reachabilityQuery.data ?? null

  // Filters the user built, translated for the backend. The saved list is
  // created from THIS (overlay-free); the count adds the overlay on top.
  const createPayload = useMemo(
    () => ({
      ...transformVoterFileFiltersForBackend(builderFilters),
      ...(builderSupportStatus.length
        ? { supportStatus: builderSupportStatus }
        : {}),
      ...(builderPrecincts.length ? { precincts: builderPrecincts } : {}),
    }),
    [builderFilters, builderSupportStatus, builderPrecincts],
  )
  // Key the memo on the overlay's VALUE, not its identity, so a caller passing
  // an inline `{ hasLandline: true }` each render can't churn the payload and
  // spin useListWizardCount's debounce effect into an update loop.
  const overlayKey = JSON.stringify(countOverlay ?? {})
  const countPayload = useMemo(
    () => ({ ...createPayload, ...(countOverlay ?? {}) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [createPayload, overlayKey],
  )

  const builderCountResult = useListWizardCount(
    countPayload,
    open && active && mode !== 'picker',
  )
  // Guard the undefined-count clause with !isError: on a non-cap count failure
  // the count is undefined but the query has settled, so treating it as "still
  // counting" would spin the CTA forever with no recovery (matches the isError
  // guard on builderZeroMatch below).
  const builderCounting =
    builderCountResult.isLoading ||
    builderCountResult.isStale ||
    (!builderCountResult.isError && builderCountResult.count === undefined)
  const builderZeroMatch =
    !builderCountResult.isLoading &&
    !builderCountResult.isStale &&
    !builderCountResult.isError &&
    builderCountResult.count === 0

  const createListMutation = useMutation({
    mutationFn: async () => {
      const { data } = await clientRequest(
        'POST /v1/voters/voter-file/filter',
        { name: builderName.trim(), ...createPayload },
      )
      return data
    },
  })
  // react-query's mutate/reset are stable references; destructure so the
  // callbacks below can depend on them without churning identity (a fresh
  // closure each render would re-fire consumers' open/reset effects — an
  // update loop).
  const {
    mutateAsync: runCreateList,
    reset: resetCreateMutation,
    isPending: createListPending,
    isError: createListError,
  } = createListMutation

  const resetBuilder = useCallback(() => {
    setMode('picker')
    setBuilderFilters({})
    setBuilderSupportStatus([])
    setBuilderPrecincts([])
    setBuilderName('')
    resetCreateMutation()
  }, [resetCreateMutation])

  const reset = useCallback(() => {
    setMode('picker')
    setSelectedListId(null)
    setBuilderFilters({})
    setBuilderSupportStatus([])
    setBuilderPrecincts([])
    setBuilderName('')
    resetCreateMutation()
  }, [resetCreateMutation])

  const startBuilder = useCallback(() => setMode('filters'), [])

  const createList = useCallback(async (): Promise<SegmentResponse> => {
    const created = await runCreateList()
    await queryClient.invalidateQueries({
      queryKey: outreachAudienceListsKey(orgSlug),
    })
    // The CRM lists tab reads the same endpoint under its own key; refresh it
    // too (fire-and-forget — it isn't mounted here) so a list built in this
    // flow shows up there without waiting out its default staleTime, mirroring
    // the reverse sync the CRM dialogs now do for this key.
    queryClient.invalidateQueries({
      queryKey: ['custom-segments', orgSlug],
    })
    setSelectedListId(created.id)
    resetBuilder()
    return created
  }, [runCreateList, queryClient, resetBuilder, orgSlug])

  return {
    mode,
    setMode,
    selectedListId,
    lists,
    listsLoading: listsQuery.isLoading,
    selectedList,
    reachableCount,
    // isFetching (not isLoading) so a re-selected, already-cached list still
    // shows the spinner during its background refetch — isLoading is true only
    // on the first-ever fetch, so under the 5-min default staleTime a stale
    // count would otherwise render with no loading state.
    reachableLoading: reachabilityQuery.isFetching,
    builderFilters,
    setBuilderFilters,
    builderSupportStatus,
    setBuilderSupportStatus,
    builderPrecincts,
    setBuilderPrecincts,
    precinctOptions,
    builderName,
    setBuilderName,
    isElectedOfficial,
    builderCount: builderCountResult.count,
    builderCounting,
    builderCapError: builderCountResult.isCapError,
    builderCountErrorMessage: builderCountResult.errorMessage,
    builderZeroMatch,
    onSelect: setSelectedListId,
    startBuilder,
    createList,
    createListPending,
    createListError,
    clearCreateError: resetCreateMutation,
    resetBuilder,
    reset,
  }
}
