import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ListDetailReachability,
  RecommendedList,
  RecommendedListChannel,
  RecommendedListFilter,
  RecommendedListIntent,
  RecommendedListVariant,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useElectedOffice } from '@shared/hooks/useElectedOffice'
import { useOrganization } from '@shared/organization-picker'
import { fetchListDetailThrottled } from 'app/dashboard/contacts/crm/lists/useListRowDetail'
import { AUTO_VOTER_FILTER_NAME_PATTERN } from 'app/dashboard/outreach/util/autoVoterFilterName.util'
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
import {
  builderFiltersFromRecommendation,
  intentForOutreachPurpose,
} from './recommendedListMapping.util'

export { intentForOutreachPurpose }

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
  // The reach count comes from GET /v1/contacts/list-detail, which is
  // Pro-gated. A free candidate on the build path would only ever get a 403
  // from it, so that mode turns the query off and reads the count off the
  // recommendation it picked instead.
  reachCountDisabled?: boolean
  // The channel's reachability overlay applied to the in-flow BUILDER count so
  // the running total matches what the feature will actually reach (robocall:
  // { hasLandline: true }). It is deliberately NOT written into the saved list
  // — the list stays general so other features can reuse it; the overlay (and
  // the equivalent server-side reachability leaf) re-applies per send.
  countOverlay?: Record<string, unknown>
  // The outreach purpose's mapped intent (docs/features/recommended-lists.md).
  // Null/undefined means "no recommendations for this purpose" (custom, or a
  // channel that hasn't wired a purpose->intent mapping yet) — the
  // recommendations query simply never fires.
  recommendedListIntent?: RecommendedListIntent | null
  // A saved list the caller wants selected on open (the outreach hub's
  // `?listId=` deep link). Applied once, and only if it names a row the
  // picker actually has — a deleted, archived or foreign id is a missed
  // preselection, never a broken step, the same rule door knocking's
  // CreateListFlow applies to the id it carries.
  preselectedListId?: number
  // A recommendation carried in from the voter data page (`?recommended=`),
  // not saved yet. Fetched for THIS channel from open — so it is cut and
  // priced the way the flow will send it, and ready by the audience step —
  // and handed to the step, which applies it on arrival the way a tap on its
  // card would. Whether that has happened lives here rather than in the
  // step, which unmounts between steps.
  preselectedRecommendedVariant?: RecommendedListVariant
}

export interface OutreachAudience {
  mode: OutreachAudienceMode
  setMode: (mode: OutreachAudienceMode) => void
  selectedListId: number | null
  lists: SegmentResponse[]
  listsLoading: boolean
  // isFetching, not isLoading: with staleTime 0 a re-opened flow serves the
  // cached lists while a refetch is in flight, and isLoading reads false the
  // moment any cache exists. A consumer acting once on the resolved lists
  // (PhoneBankingFlow's deep-link preselect) must wait on this so it never
  // matches against a stale cache — same distinction reachableLoading below
  // already applies.
  listsFetching: boolean
  selectedList: SegmentResponse | null
  reachableCount: number | null
  // The selected list's TOTAL people count (list-detail demographics), so a
  // channel can render the reachable-of-total delta (ENG-10957). Null on the
  // same terms as reachableCount.
  selectedListTotal: number | null
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
  recommendations: RecommendedList[]
  recommendationsLoading: boolean
  recommendationsError: boolean
  // The channel the recommendations were requested for — a recommendation
  // carries no channel of its own (it's the query param, one per request).
  recommendedListsChannel: RecommendedListChannel
  // Seeds the builder from a recommendation and creates the saved list in
  // one call, using the caller's chosen name (the picker's naming drawer
  // pre-fills it from the recommendation's copy.title and lets the
  // candidate edit before submit). Only for a recommendation with no
  // existingFilterId — a caller with one should call
  // onSelect(existingFilterId) instead of this.
  createRecommendedList: (
    recommendation: RecommendedList,
    name: string,
  ) => Promise<SegmentResponse>
  createRecommendedListPending: boolean
  // The message for a createRecommendedList that failed from the step's
  // Continue (the naming drawer shows its own); cleared by the next
  // selection or attempt.
  createRecommendedListError: string | null
  // A recommendation chosen as the audience without being saved yet — the
  // carried-in card on arrival. Mutually exclusive with selectedListId:
  // picking a saved list or opening the builder drops it, and Continue
  // saves it (under its own title) before advancing.
  selectedRecommendation: RecommendedList | null
  selectRecommendation: (recommendation: RecommendedList) => void
  // The conversion event for a recommendation that resolved to a list the
  // candidate already has. `applyRecommendation` deliberately does not
  // handle that case (each flow attaches its own side effects to selecting
  // a list), so the accept has to be reported from the same branch.
  trackRecommendationReused: (recommendation: RecommendedList) => void
  // The carried-in recommendation, once fetched for this channel, and
  // whether the audience step has applied it yet.
  preselectedRecommendation: RecommendedList | null
  preselectedRecommendationApplied: boolean
  markPreselectedRecommendationApplied: () => void
}

export const useOutreachAudience = ({
  open,
  active,
  reachabilityKey,
  countOverlay,
  recommendedListIntent = null,
  preselectedListId,
  preselectedRecommendedVariant,
  reachCountDisabled = false,
}: UseOutreachAudienceParams): OutreachAudience => {
  const [mode, setMode] = useState<OutreachAudienceMode>('picker')
  const [selectedListId, setSelectedListId] = useState<number | null>(null)
  const [selectedRecommendation, setSelectedRecommendation] =
    useState<RecommendedList | null>(null)
  // The count of the recommendation the selected saved list came from, kept
  // against that list's id. Both accept branches record it — the card that
  // resolved to a list the candidate already had, and the card saved for the
  // first time — because it is the only reach figure available when the
  // Pro-gated list-detail read is off.
  const [recommendationSnapshot, setRecommendationSnapshot] = useState<{
    listId: number
    count: number
  } | null>(null)
  const [createRecommendedListPending, setCreateRecommendedListPending] =
    useState(false)
  const [createRecommendedListError, setCreateRecommendedListError] = useState<
    string | null
  >(null)
  const [builderFilters, setBuilderFilters] = useState<VoterFileFilters>({})
  const [builderSupportStatus, setBuilderSupportStatus] = useState<
    SupportStatusRollup[]
  >([])
  const [builderPrecincts, setBuilderPrecincts] = useState<string[]>([])
  const [builderName, setBuilderName] = useState('')
  // Which carried-in variant the audience step has already applied. Held
  // here and not in the step because the step unmounts between steps, and
  // Back into it must not reopen a naming drawer the candidate dismissed.
  const [appliedPreselectedVariant, setAppliedPreselectedVariant] =
    useState<RecommendedListVariant | null>(null)
  // Provenance of the current builder selection, when it originated from a
  // recommendation. gp-api persists variant/channel/intent on the created
  // filter and diffs the submitted filter against `filter` (the
  // recommendation's own unsaved shape) to set recommendedModified — this
  // is just the carrier, plus what the analytics event needs on accept.
  const [recommendedMeta, setRecommendedMeta] = useState<{
    variant: RecommendedListVariant
    channel: RecommendedListChannel
    intent: RecommendedListIntent
    filter: RecommendedListFilter
    count: number
    voteGoalShare?: number
  } | null>(null)

  const { data: electedOffice } = useElectedOffice()
  const isElectedOfficial = !!electedOffice
  // Same gating as the builder's count below: the flow host stays mounted, so
  // an ungated fetch would run for every outreach page view. 'picker' mode
  // shows saved lists only — the precinct control cannot render until the
  // builder is open on its filters step.
  const precinctOptions = usePrecinctOptions(
    open && active && mode !== 'picker',
  )

  // Scope the saved-lists cache by org: with staleTime 0 the cached entry is
  // still served during an in-flight refetch, so an unscoped key would briefly
  // surface a prior org's lists after an org switch (matches the CRM callers'
  // ['custom-segments', orgSlug] scoping).
  const orgSlug = useOrganization()?.slug
  const queryClient = useQueryClient()

  const recommendationsQuery = useQuery({
    queryKey: [
      'outreach-audience-recommendations',
      orgSlug,
      reachabilityKey,
      recommendedListIntent,
    ],
    queryFn: async () => {
      const { data } = await clientRequest(
        'GET /v1/campaigns/mine/recommended-lists',
        {
          channel: reachabilityKey,
          // Guarded by `enabled` below.
          intent: recommendedListIntent ?? undefined,
        },
      )
      return data
    },
    // Same gating as precinctOptions/builderCountResult elsewhere in this
    // hook: the flow host stays mounted (open never goes false between
    // steps), so without active/mode this kept refetching a
    // warehouse-backed call on window-focus for schedule/compose/review —
    // steps that don't show it.
    enabled:
      open && active && mode === 'picker' && recommendedListIntent !== null,
    staleTime: 0,
  })

  // Fetched from open rather than from the audience step, so the candidate
  // never waits on a warehouse aggregate they already saw on the voter data
  // page. Cut for this channel: the count and price are the flow's own.
  const preselectedRecommendationQuery = useQuery({
    queryKey: [
      'outreach-audience-preselected-recommendation',
      orgSlug,
      reachabilityKey,
      preselectedRecommendedVariant,
    ],
    queryFn: async () => {
      const { data } = await clientRequest(
        'GET /v1/campaigns/mine/recommended-lists',
        {
          channel: reachabilityKey,
          // Guarded by `enabled` below.
          variant: preselectedRecommendedVariant,
        },
      )
      return data[0] ?? null
    },
    enabled: open && preselectedRecommendedVariant !== undefined,
    refetchOnWindowFocus: false,
  })

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

  // Apply the caller's preselected list once its row arrives. Spent on
  // application rather than bound to the prop: the candidate must be able to
  // pick something else and have that stick, including across the refetches
  // this query does on window focus. Re-arms on a different id, so a second
  // deep link into a still-mounted flow preselects too.
  const appliedPreselectRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (preselectedListId === undefined) return
    if (appliedPreselectRef.current === preselectedListId) return
    if (!lists.some((l) => l.id === preselectedListId)) return
    appliedPreselectRef.current = preselectedListId
    setSelectedListId(preselectedListId)
  }, [preselectedListId, lists])

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
      return {
        reachable: detail.reachability[reachabilityKey],
        total: detail.demographics.people,
      }
    },
    // A list built in the flow is selected as we leave the audience step
    // (createList -> the flow's goToSchedule in the same tick), so gating this
    // on `active` meant the count never fetched for a built list and the
    // review/pay steps read a null (rendered 0) reachable count. Fetch whenever
    // a list is selected; the automatic refetches the `active` gate used to
    // guard against are suppressed directly below.
    enabled: open && selectedListId !== null && !reachCountDisabled,
    // Both window-focus and reconnect refetches are disabled for the same
    // reason: on a post-audience step (schedule/compose/review) a focus regain
    // or a network reconnect (common on mobile) would, under staleTime:0, refire
    // fetchListDetailThrottled and burn one of the global MAX_IN_FLIGHT (3)
    // list-detail slots — with no UI benefit, since the count is already
    // resolved by then. The initial fetch on selection still runs (the query
    // observer mounts once at the flow root and persists across steps, so
    // refetchOnMount is not a factor here).
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // Refetch on every (re)selection so the isFetching-driven spinner below
    // actually fires: under the app's 5-min default staleTime a re-picked list
    // is still "fresh", no background refetch runs, isFetching stays false, and
    // a stale count would render with no loading state (matches listsQuery).
    staleTime: 0,
  })
  // A selected recommendation was already counted for this channel by the
  // endpoint, so its count is the reach — there is no saved list to ask.
  // A recommendation that resolved to a list the candidate already has is
  // selected AS that list, so its own count is the only one on hand when
  // list-detail is off (second visit, free build path).
  const reachableCount = selectedRecommendation
    ? selectedRecommendation.count
    : (reachabilityQuery.data?.reachable ??
      (recommendationSnapshot?.listId === selectedListId
        ? recommendationSnapshot.count
        : null))
  const selectedListTotal = reachabilityQuery.data?.total ?? null

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
        {
          name: builderName.trim(),
          ...createPayload,
          // recommendedFilter is the recommendation's own unsaved filter
          // shape, sent alongside the submitted criteria purely so gp-api
          // can diff the two and persist recommendedModified — nothing
          // recommendation-time is otherwise saved anywhere to diff against.
          ...(recommendedMeta
            ? {
                recommendedVariant: recommendedMeta.variant,
                recommendedChannel: recommendedMeta.channel,
                recommendedIntent: recommendedMeta.intent,
                recommendedFilter: recommendedMeta.filter,
              }
            : {}),
        },
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
    setRecommendedMeta(null)
    resetCreateMutation()
  }, [resetCreateMutation])

  const reset = useCallback(() => {
    setMode('picker')
    setSelectedListId(null)
    setSelectedRecommendation(null)
    setRecommendationSnapshot(null)
    setCreateRecommendedListError(null)
    appliedPreselectRef.current = undefined
    setAppliedPreselectedVariant(null)
    setBuilderFilters({})
    setBuilderSupportStatus([])
    setBuilderPrecincts([])
    setBuilderName('')
    setRecommendedMeta(null)
    resetCreateMutation()
  }, [resetCreateMutation])

  // Opening the builder leaves a selected recommendation behind: what gets
  // cut from here is a new audience, not that card.
  const startBuilder = useCallback(() => {
    setSelectedRecommendation(null)
    setMode('filters')
  }, [])

  const selectList = useCallback((id: number | null) => {
    setSelectedListId(id)
    setSelectedRecommendation(null)
  }, [])

  const selectRecommendation = useCallback(
    (recommendation: RecommendedList) => {
      setSelectedRecommendation(recommendation)
      setSelectedListId(null)
      setCreateRecommendedListError(null)
    },
    [],
  )

  // Only for a recommendation whose existingFilterId is null — the caller is
  // expected to route that case at onSelect(existingFilterId) instead, since
  // that path already carries each flow's own side effects (e.g. SmsFlow
  // clearing a stale phone-list token on audience change).
  // Seeds the builder state that createList (and its recommendedMeta-driven
  // Accepted event) reads. Kept private — the picker's flow is
  // createRecommendedList below, which seeds + creates in one atomic call
  // rather than staging the seed for a separate submit.
  const seedFromRecommendation = useCallback(
    (recommendation: RecommendedList, name: string) => {
      setBuilderFilters(builderFiltersFromRecommendation(recommendation.filter))
      setBuilderSupportStatus(recommendation.filter.supportStatus ?? [])
      setBuilderPrecincts(recommendation.filter.precincts ?? [])
      setBuilderName(name)
      setRecommendedMeta({
        variant: recommendation.variant,
        channel: reachabilityKey,
        // The variant's own intent, not this flow's purpose: a recommendation
        // carried in from the voter data page belongs to whichever intent
        // the registry says, whatever purpose the candidate picked here.
        intent: recommendation.intent,
        filter: recommendation.filter,
        count: recommendation.count,
        voteGoalShare: recommendation.voteGoalShare,
      })
    },
    [reachabilityKey],
  )

  // The other half of the conversion measurement. A recommendation the
  // candidate has already taken once resolves to an existing saved list, so
  // it is selected rather than created — which routes around `createList`
  // entirely and, unmeasured, biased the accepted population to first-time
  // accepts. `modified` is false by construction: nothing was submitted, so
  // there is nothing for gp-api to diff. `reusedExistingList` is what keeps
  // the two kinds of accept separable in the funnel rather than conflated.
  const trackRecommendationReused = useCallback(
    (recommendation: RecommendedList) => {
      if (recommendation.existingFilterId !== null) {
        setRecommendationSnapshot({
          listId: recommendation.existingFilterId,
          count: recommendation.count,
        })
      }
      trackEvent(EVENTS.Outreach.RecommendedList.Accepted, {
        variant: recommendation.variant,
        channel: reachabilityKey,
        intent: recommendation.intent,
        count: recommendation.count,
        voteGoalShare: recommendation.voteGoalShare,
        modified: false,
        reusedExistingList: true,
      })
    },
    [reachabilityKey],
  )

  // Seeds the builder from a recommendation, then POSTs the create with an
  // explicitly-passed name — the drawer's name input is the source of truth,
  // so building the payload from arguments (rather than from useState that
  // may not have flushed) avoids a stale-name race. Fires the same Accepted
  // event createList's `recommendedMeta` branch does, then does the same
  // cache invalidation + select-and-reset. Errors bubble; the drawer catches
  // and shows an inline message.
  const createRecommendedList = useCallback(
    async (
      recommendation: RecommendedList,
      name: string,
    ): Promise<SegmentResponse> => {
      seedFromRecommendation(recommendation, name)
      const trimmed = name.trim()
      const filters = builderFiltersFromRecommendation(recommendation.filter)
      const supportStatus = recommendation.filter.supportStatus ?? []
      const precincts = recommendation.filter.precincts ?? []
      setCreateRecommendedListPending(true)
      setCreateRecommendedListError(null)
      let data: SegmentResponse
      try {
        const response = await clientRequest(
          'POST /v1/voters/voter-file/filter',
          {
            name: trimmed,
            ...transformVoterFileFiltersForBackend(filters),
            ...(supportStatus.length ? { supportStatus } : {}),
            ...(precincts.length ? { precincts } : {}),
            recommendedVariant: recommendation.variant,
            recommendedChannel: reachabilityKey,
            recommendedIntent: recommendation.intent,
            recommendedFilter: recommendation.filter,
          },
        )
        data = response.data
      } catch (error) {
        setCreateRecommendedListError("We couldn't save this list. Try again.")
        throw error
      } finally {
        setCreateRecommendedListPending(false)
      }
      trackEvent(EVENTS.Outreach.RecommendedList.Accepted, {
        variant: recommendation.variant,
        channel: reachabilityKey,
        intent: recommendation.intent,
        count: recommendation.count,
        voteGoalShare: recommendation.voteGoalShare,
        modified: data.recommendedModified ?? false,
        reusedExistingList: false,
      })
      await queryClient.invalidateQueries({
        queryKey: outreachAudienceListsKey(orgSlug),
      })
      queryClient.invalidateQueries({
        queryKey: ['custom-segments', orgSlug],
      })
      setSelectedListId(data.id)
      // The card's own count is the reach figure for the list it just
      // became: selecting it drops `selectedRecommendation`, and with the
      // Pro-gated list-detail read off nothing else can supply one.
      setRecommendationSnapshot({
        listId: data.id,
        count: recommendation.count,
      })
      setSelectedRecommendation(null)
      resetBuilder()
      return data
    },
    [
      seedFromRecommendation,
      reachabilityKey,
      queryClient,
      resetBuilder,
      orgSlug,
    ],
  )

  const createList = useCallback(async (): Promise<SegmentResponse> => {
    const created = await runCreateList()
    // Only knowable now: whether the candidate accepted the recommendation
    // as-is or edited it first (gp-api's recommendedModified, computed at
    // create time). Fires here rather than on card selection, and not at
    // all for a hand-built list (recommendedMeta null).
    if (recommendedMeta) {
      trackEvent(EVENTS.Outreach.RecommendedList.Accepted, {
        variant: recommendedMeta.variant,
        channel: recommendedMeta.channel,
        intent: recommendedMeta.intent,
        count: recommendedMeta.count,
        voteGoalShare: recommendedMeta.voteGoalShare,
        modified: created.recommendedModified ?? false,
        reusedExistingList: false,
      })
    }
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
  }, [runCreateList, recommendedMeta, queryClient, resetBuilder, orgSlug])

  return {
    mode,
    setMode,
    selectedListId,
    lists,
    listsLoading: listsQuery.isLoading,
    listsFetching: listsQuery.isFetching,
    selectedList,
    reachableCount,
    selectedListTotal,
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
    onSelect: selectList,
    startBuilder,
    selectedRecommendation,
    selectRecommendation,
    createRecommendedListPending,
    createRecommendedListError,
    createList,
    createListPending,
    createListError,
    clearCreateError: resetCreateMutation,
    resetBuilder,
    reset,
    recommendations: recommendationsQuery.data ?? [],
    // The carried-in recommendation shares the landing skeleton: applying it
    // is the first thing the step does, so the picker must not paint first.
    recommendationsLoading:
      recommendationsQuery.isLoading ||
      preselectedRecommendationQuery.isLoading,
    recommendationsError: recommendationsQuery.isError,
    recommendedListsChannel: reachabilityKey,
    createRecommendedList,
    trackRecommendationReused,
    preselectedRecommendation: preselectedRecommendationQuery.data ?? null,
    preselectedRecommendationApplied:
      preselectedRecommendedVariant !== undefined &&
      appliedPreselectedVariant === preselectedRecommendedVariant,
    markPreselectedRecommendationApplied: () =>
      setAppliedPreselectedVariant(preselectedRecommendedVariant ?? null),
  }
}
