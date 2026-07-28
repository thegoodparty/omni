'use client'

import H1 from '@shared/typography/H1'
import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@styleguide'
import { LoaderCircleIcon } from '@styleguide/components/ui/icons'
import { Alert, AlertDescription, AlertTitle } from '@styleguide'
import { MdError } from 'react-icons/md'
import CustomVoterAudienceFilters, {
  TRACKING_KEYS,
  AudienceFiltersState,
  AudienceFilterKey,
} from 'app/dashboard/components/tasks/flows/CustomVoterAudienceFilters'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clientRequest } from 'gpApi/typed-request'
import { countVoterFile, CountVoterFileError } from './RecordCount'
import { numberFormatter } from 'helpers/numberHelper'
import {
  LEGACY_TASK_TYPES,
  TASK_TYPES,
} from '../../../shared/constants/tasks.const'
import { buildTrackingAttrs } from 'helpers/analyticsHelper'
import { useCampaign } from '@shared/hooks/useCampaign'
import { FREE_TEXTS_OFFER } from '../../../outreach/constants'
import { useP2pUxEnabled } from 'app/dashboard/components/tasks/flows/hooks/P2pUxEnabledProvider'
import { PhoneListInput } from 'helpers/createP2pPhoneList'
import { AUTO_VOTER_FILTER_NAME_PATTERN } from 'app/dashboard/components/tasks/flows/util/flowHandlers.util'
import { fetchListDetail } from 'app/dashboard/contacts/crm/lists/useListRowDetail'
import type { ListDetailReachability } from 'app/dashboard/contacts/crm/shared/contacts-types'
import { formatFencedCount } from 'app/dashboard/contacts/crm/shared/formatFencedCount.util'
import { REACHABILITY_CHANNELS } from 'app/dashboard/contacts/crm/shared/reachabilityChannels'

const TEXT_PRICE = 0.035
const CALL_PRICE = 0.04
const CALL_W_VOICEMAIL_PRICE = 0.055

const NEW_FROM_FILTERS = '__new__'

// ENG-10799: the reachability leaves a saved-list outreach flow can map to
// (excludes 'fenced' and 'polls' — no flow here sends polls, which mirrors
// sms 1:1 anyway).
type ReachabilityCountKey = keyof Omit<
  ListDetailReachability,
  'fenced' | 'polls'
>

interface SavedList {
  id: number
  name?: string
  [key: string]: unknown
}

const MISSING_L2_DISTRICT_DATA_ERROR_CODE = 'MISSING_L2_DISTRICT_DATA'
const MISSING_L2_DISTRICT_DATA_DEFAULT_MESSAGE =
  'Voter data is not available for your selected office. Please contact support at help@goodparty.org so we can update your district information.'
const GENERIC_COUNT_ERROR_MESSAGE =
  'We were unable to count voters for this audience. Please try again, or contact support if the problem persists.'

const isAudienceFilterKey = (
  key: string,
  audience: AudienceFiltersState,
): key is AudienceFilterKey => {
  return key in audience
}

type VoterFileFilterResult = PhoneListInput & { id?: number }

// ENG-10767: how the audience was chosen, carried as a property on the
// audience-step Next and Voter Outreach - Campaign Completed events so the
// CRM list → outreach funnel is attributable end to end. 'deepLink' means
// the CRM "Send outreach" link's preselected list was still the selection at
// advance time; a manual dropdown pick (even of the same list) is
// 'savedList'; no saved list means the checkbox-built audience.
export type AudienceSource = 'savedList' | 'deepLink' | 'customFilters'

interface AudienceStepProps {
  onChangeCallback: (
    keyOrData:
      | string
      | {
          voterFileFilter?: VoterFileFilterResult
          phoneListToken: string | null | undefined
          savedListId?: number
          audienceSource: AudienceSource
          audienceListId: number | null
        },
    value?: AudienceFiltersState | number,
  ) => void
  nextCallback: () => void
  backCallback: () => void
  type: string
  withVoicemail?: boolean
  audience: AudienceFiltersState
  isCustom?: boolean
  onCreateVoterFileFilter?: () => Promise<VoterFileFilterResult | undefined>
  onCreatePhoneList?: (
    voterFileFilter: VoterFileFilterResult | undefined,
    voterFileFilterId?: number,
  ) => Promise<string | null | undefined>
  preselectedListId?: number
}

export default function AudienceStep({
  onChangeCallback,
  nextCallback,
  backCallback,
  type,
  withVoicemail,
  audience,
  isCustom,
  onCreateVoterFileFilter = async () => ({}),
  onCreatePhoneList = async () => null,
  preselectedListId,
}: AudienceStepProps): React.JSX.Element {
  const [campaign] = useCampaign()
  const { p2pUxEnabled } = useP2pUxEnabled()
  const [count, setCount] = useState(0)
  // Whether `count` is a FENCE_LIMIT-capped lower bound (ENG-10775/10805)
  // rather than an exact figure — only ever true for the saved-list branch.
  const [countFenced, setCountFenced] = useState(false)
  // ENG-10808: the saved list's raw membership (demographics.people),
  // tracked alongside the channel-eligible `count` so the audience step can
  // show a "7,032 people in this list · 1,607 reachable by robocall"
  // breakdown instead of just the eligible number — a user who came in
  // expecting to text/call their whole list needs to see why they're
  // quoted a smaller number. Only ever set on the saved-list branch.
  const [listSize, setListSize] = useState<number | null>(null)
  const [listSizeFenced, setListSizeFenced] = useState(false)
  const [loading, setLoading] = useState(false)
  const [countError, setCountError] = useState<CountVoterFileError | null>(null)
  // Tracks the latest count request so out-of-order responses can be dropped.
  // See useEffect below.
  const countRequestIdRef = useRef(0)
  // Component-scoped debounce timer. We don't use the shared `debounce` helper
  // because it stores its handle on `window.timer` — any other caller in the
  // app can clear our pending fetch.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasValues = useMemo(
    () => Object.values(audience).some((value) => value === true),
    [audience],
  )

  const isTextType = type === LEGACY_TASK_TYPES.sms || type === TASK_TYPES.text
  const isRobocallType =
    type === LEGACY_TASK_TYPES.telemarketing || type === TASK_TYPES.robocall
  const isPhoneBankingType = type === TASK_TYPES.phoneBanking
  const isDoorKnockingType = type === TASK_TYPES.doorKnocking
  // ENG-10764/10765/10784: robocall, phone banking, and door knocking all get
  // the same saved-list selector as text.
  const showsSavedListSelector =
    isTextType || isRobocallType || isPhoneBankingType || isDoorKnockingType
  // ENG-10799: a saved list's raw membership (demographics.people) is not
  // what a channel can actually reach — e.g. a 7,032-person list with 1,607
  // landline holders must price/report as a 1,607-person robocall, not
  // 7,032. Every saved-list flow now reads its own reachability leaf
  // instead: robocall's landline count, phone banking/door knocking's
  // reachable count, and text's SMS-eligible count (previously left at 0
  // here on the theory that the later phone-list build owns the real
  // number — but the estimate, cost preview, and persisted voterCount all
  // need the eligible count up front too, same as the other three flows).
  const reachabilityKey: ReachabilityCountKey | null = isRobocallType
    ? 'robocall'
    : isPhoneBankingType
      ? 'phoneBanking'
      : isDoorKnockingType
        ? 'doorKnocking'
        : isTextType
          ? 'sms'
          : null
  const fetchesSavedListCount = reachabilityKey !== null
  // ENG-10808: reuses the list-detail sheet's canonical channel labels
  // (`ReachabilityGrid`'s source) so the breakdown sentence can't drift
  // from "Text"/"Robocall"/"Phone banking"/"Door knocking" elsewhere in the
  // CRM — lowercased to read as a mid-sentence noun phrase.
  const reachabilityChannelLabel = reachabilityKey
    ? (REACHABILITY_CHANNELS.find(
        (channel) => channel.key === reachabilityKey,
      )?.label.toLowerCase() ?? null)
    : null

  const [savedLists, setSavedLists] = useState<SavedList[]>([])
  // Empty string = "build a new audience from the checkboxes" (the default).
  const [selectedListId, setSelectedListId] = useState('')
  // ENG-10767: whether the current saved-list selection came from the CRM
  // deep link's preselect or a manual dropdown pick — a user who manually
  // re-picks (or switches away from) the deep-linked list is reporting their
  // own choice, not the link's.
  const [selectionSource, setSelectionSource] = useState<
    'manual' | 'deepLink' | null
  >(null)

  const selectedList = useMemo(
    () =>
      selectedListId === '' || selectedListId === NEW_FROM_FILTERS
        ? null
        : (savedLists.find((l) => l.id.toString() === selectedListId) ?? null),
    [selectedListId, savedLists],
  )

  const handleSelectList = useCallback(
    (value: string, source: 'manual' | 'deepLink' = 'manual') => {
      setSelectedListId(value === NEW_FROM_FILTERS ? '' : value)
      setSelectionSource(value === NEW_FROM_FILTERS ? null : source)
    },
    [],
  )

  // ENG-10763: applies the CRM "Send outreach" list link's preselectedListId
  // whenever a NEW id arrives that hasn't been applied yet (tracked by value,
  // not a one-shot boolean — a caller like OutreachCreateCards can update the
  // id it threads down, e.g. a later deep link while this step stays
  // mounted, and that new id must still take). Never re-applies the SAME id
  // again, so a user who deliberately switches lists (or back to "Build a
  // new audience") doesn't get snapped back to it on a later re-render.
  const lastAppliedPreselectListIdRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!showsSavedListSelector) return
    let active = true
    clientRequest('GET /v1/voters/voter-file/filters', {})
      .then(({ data }) => {
        if (!active) return
        const filtered = (data || []).filter(
          (list): list is SavedList =>
            typeof list?.name === 'string' &&
            !AUTO_VOTER_FILTER_NAME_PATTERN.test(list.name),
        )
        setSavedLists(filtered)
        if (
          preselectedListId !== undefined &&
          preselectedListId !== lastAppliedPreselectListIdRef.current
        ) {
          const match = filtered.find((list) => list.id === preselectedListId)
          if (match) {
            lastAppliedPreselectListIdRef.current = preselectedListId
            // Reuse the exact same code path a manual dropdown pick takes —
            // no separate "preselected" state to keep in sync.
            handleSelectList(match.id.toString(), 'deepLink')
          }
        }
      })
      .catch(() => {
        // A failed list fetch must not block the build-new-from-checkboxes
        // path — the selector just stays empty.
        if (active) setSavedLists([])
      })
    return () => {
      active = false
    }
  }, [showsSavedListSelector, preselectedListId, handleSelectList])

  const nextTrackingAttrs = useMemo(
    () => buildTrackingAttrs('Next Target Audience', { type }),
    [type],
  )

  const backTrackingAttrs = useMemo(
    () => buildTrackingAttrs('Back Target Audience', { type }),
    [type],
  )

  const handleOnNext = async () => {
    if (countError) {
      return
    }

    // Invalidate any in-flight count fetch so its .finally() can't flip
    // loading back off (re-enabling Next) mid-submission.
    countRequestIdRef.current += 1
    setLoading(true)

    // A selected saved list is reused as-is: its id links the outreach and its
    // persisted filter fields drive the Peerly CSV — no throwaway filter is
    // POSTed. Otherwise build a new filter from the checkbox selections.
    const voterFileFilter = selectedList
      ? (selectedList as VoterFileFilterResult)
      : await onCreateVoterFileFilter()
    if (!voterFileFilter) {
      setLoading(false)
      return
    }

    const needsPhoneList = p2pUxEnabled && isTextType
    // Only a saved list the user picked from the dropdown carries a
    // voterFileFilterId here — an ad-hoc audience built from checkboxes
    // stays undefined even though onCreateVoterFileFilter() also persists a
    // (throwaway, auto-named) filter row with its own id.
    const phoneListToken = needsPhoneList
      ? await onCreatePhoneList(voterFileFilter, selectedList?.id)
      : null

    if (needsPhoneList && !phoneListToken) {
      setLoading(false)
      return
    }

    setLoading(false)
    onChangeCallback({
      voterFileFilter,
      phoneListToken,
      // ENG-10767: reported on every advance (not just when a list is
      // selected) so a Back-then-switch to custom filters overwrites the
      // earlier value instead of leaving a stale saved-list attribution.
      audienceSource: selectedList
        ? selectionSource === 'deepLink'
          ? 'deepLink'
          : 'savedList'
        : 'customFilters',
      audienceListId: selectedList?.id ?? null,
      // ENG-10765/10784: DownloadStep needs to tell a saved list (segment
      // export) apart from a throwaway checkbox-built filter (both carry an
      // `id`), so phone banking and door knocking always report the current
      // selection — present but undefined when the user switches back to
      // "build a new audience" — so a stale selection from an earlier Next
      // press can't linger.
      ...(isPhoneBankingType || isDoorKnockingType
        ? { savedListId: selectedList?.id }
        : {}),
    })
    nextCallback()
  }

  useEffect(() => {
    // Bump the request ID up front so any in-flight response from a prior
    // filter combination is dropped on arrival. countVoterFile has no abort
    // support, so the network call still completes — we just ignore it.
    const requestId = ++countRequestIdRef.current

    // A selected saved list drives the audience server-side from its persisted
    // fields; the checkbox-based live count doesn't apply to it.
    if (selectedList) {
      if (!reachabilityKey) {
        setCountError(null)
        setCount(0)
        setCountFenced(false)
        setListSize(null)
        setListSizeFenced(false)
        setLoading(false)
        onChangeCallback('voterCount', 0)
        return
      }

      // ENG-10799: pull the channel-eligible count off the list's
      // reachability leaf (robocall's landline count, phone
      // banking/door knocking's reachable count, text's SMS-eligible
      // count) instead of demographics.people, the raw list size — that's
      // the number that drives the voters-selected display, the robocall
      // cost preview, and the zero-member Next guard on every flow's
      // download path. Shares the fetch with the CRM lists index (see
      // fetchListDetail) instead of a second hand-rolled call.
      setCountError(null)
      setLoading(true)
      fetchListDetail(selectedList.id)
        .then((data) => {
          if (requestId !== countRequestIdRef.current) return
          const eligibleCount = data.reachability[reachabilityKey]
          // ENG-10806: a null leaf means that channel's aggregate call
          // failed server-side — same unpriceable-audience treatment as
          // the catch below, not a silent $0.00. Also clears listSize
          // (ENG-10808) so the breakdown line can't render off a stale
          // list size paired with no eligible count.
          if (eligibleCount === null) {
            setCountError({ ok: false, message: GENERIC_COUNT_ERROR_MESSAGE })
            setCount(0)
            setCountFenced(false)
            setListSize(null)
            setListSizeFenced(false)
            onChangeCallback('voterCount', 0)
            return
          }
          setCount(eligibleCount)
          // A fenced count (ENG-10775/10805) is a capped lower bound, not
          // exact membership — still the safest number to bill/persist
          // (never an overcount), but flagged for display so it renders
          // with a trailing "+" instead of reading as exact.
          setCountFenced(!!data.reachability.fenced?.[reachabilityKey])
          // ENG-10808: the same response's demographics.people is the raw
          // list size — kept alongside the eligible count purely for the
          // breakdown sentence below (never sent to onChangeCallback; the
          // persisted voterCount stays the channel-eligible number).
          setListSize(data.demographics.people)
          setListSizeFenced(!!data.demographics.fenced)
          onChangeCallback('voterCount', eligibleCount)
        })
        .catch(() => {
          if (requestId !== countRequestIdRef.current) return
          // Surface the failure the same way the checkbox path does — a
          // silent $0.00 estimate here would let Next submit a robocall
          // against an uncounted (possibly large) saved list.
          setCountError({ ok: false, message: GENERIC_COUNT_ERROR_MESSAGE })
          setCount(0)
          setCountFenced(false)
          setListSize(null)
          setListSizeFenced(false)
          onChangeCallback('voterCount', 0)
        })
        .finally(() => {
          if (requestId !== countRequestIdRef.current) return
          setLoading(false)
        })
      return
    }

    if (!hasValues) {
      setCountError(null)
      setCount(0)
      setCountFenced(false)
      setLoading(false)
      onChangeCallback('voterCount', 0)
      return
    }

    setLoading(true)

    debounceTimerRef.current = setTimeout(async () => {
      if (requestId !== countRequestIdRef.current) return

      const selectedAudience = Object.keys(audience).filter(
        (key) => isAudienceFilterKey(key, audience) && audience[key] === true,
      )
      const res = await countVoterFile(isCustom ? 'custom' : type, {
        filters: selectedAudience,
      })

      if (requestId !== countRequestIdRef.current) {
        console.warn(
          `[AudienceStep] Dropping stale voter-count response (req #${requestId}, current #${countRequestIdRef.current})`,
        )
        return
      }

      if (typeof res === 'number') {
        setCountError(null)
        setCount(res)
        setCountFenced(false)
        onChangeCallback('voterCount', res)
      } else {
        setCountError(res)
        setCount(0)
        setCountFenced(false)
        onChangeCallback('voterCount', 0)
      }
      setLoading(false)
    }, 300)

    return () => {
      // Invalidate any pending debounced fetch or in-flight response so it
      // can't fire after this effect tears down (filter change, unmount).
      countRequestIdRef.current += 1
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [
    audience,
    isCustom,
    type,
    hasValues,
    selectedList,
    reachabilityKey,
    onChangeCallback,
  ])

  const handleChangeAudience = (newState: AudienceFiltersState) => {
    onChangeCallback('audience', newState)
  }

  let price: number | undefined
  // TODO: confirm these prices are correct for new task types!!!
  if (
    type === LEGACY_TASK_TYPES.telemarketing ||
    type === TASK_TYPES.robocall
  ) {
    price = withVoicemail ? CALL_W_VOICEMAIL_PRICE : CALL_PRICE
  } else if (isTextType) {
    price = TEXT_PRICE
  }
  const hasFreeTextsOffer =
    p2pUxEnabled && campaign?.hasFreeTextsOffer && isTextType

  const calculateCost = (textCount: number): number => {
    if (hasFreeTextsOffer && textCount > 0 && price !== undefined) {
      const discountedCount = Math.max(0, textCount - FREE_TEXTS_OFFER.COUNT)
      return discountedCount * price
    }
    return textCount * (price ?? 0)
  }

  const isMissingDistrictData =
    countError?.errorCode === MISSING_L2_DISTRICT_DATA_ERROR_CODE
  const inlineCountErrorMessage = countError
    ? isMissingDistrictData
      ? countError.message || MISSING_L2_DISTRICT_DATA_DEFAULT_MESSAGE
      : countError.message || GENERIC_COUNT_ERROR_MESSAGE
    : null
  const hasCountError = !!countError
  // The zero-count guard applies to every saved-list flow now that all four
  // (robocall, phone banking, door knocking, text) fetch a real
  // channel-eligible count (ENG-10799) instead of leaving one of them at 0.
  const isNextDisabled = selectedList
    ? loading || hasCountError || (fetchesSavedListCount && count === 0)
    : !hasValues || loading || hasCountError || (hasValues && count === 0)

  // Shared by the checkbox-built audience and the saved-list branch (every
  // channel now fetches its own channel-eligible count — ENG-10799 — see the
  // count useEffect above). `countFenced` is only ever set on the saved-list
  // branch; formatFencedCount renders the same as numberFormatter unless
  // that count is a capped lower bound, in which case it appends "+".
  const votersAndCostSummary = (
    <div className="p-4 text-sm">
      Voters selected:
      <span className="font-bold text-black ml-1">
        {loading ? (
          <LoaderCircleIcon
            size={14}
            className="inline-block align-middle animate-spin"
          />
        ) : (
          formatFencedCount(count, countFenced)
        )}
      </span>
      {price && (
        <>
          <span className="mx-3">|</span>
          Estimated cost:
          <span className="font-bold text-black ml-1">
            {loading ? (
              <LoaderCircleIcon
                size={14}
                className="inline-block align-middle animate-spin"
              />
            ) : (
              `$${numberFormatter(calculateCost(count), 2)}`
            )}
          </span>
        </>
      )}
    </div>
  )

  return (
    <div className="p-4 w-[80vw] max-w-4xl">
      <div className="text-center">
        <H1>Select target audience</H1>
        {hasFreeTextsOffer && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
            <span className="text-blue-800 font-medium">
              Your first text gets up to 5,000 Free messages
            </span>
          </div>
        )}
        {showsSavedListSelector && savedLists.length > 0 && (
          <div className="text-left mt-4">
            <Select value={selectedListId} onValueChange={handleSelectList}>
              <SelectTrigger className="w-full justify-start">
                <label className="text-sm font-normal text-muted-foreground border-r pr-3 border-gray-200">
                  Audience
                </label>
                <div className="w-full text-left pl-1">
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
                    <SelectItem key={list.id} value={list.id.toString()}>
                      {list.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )}
        {selectedList ? (
          <>
            <div className="p-4 text-sm text-muted-foreground">
              Using your saved list:{' '}
              <span className="font-bold text-black">{selectedList.name}</span>
            </div>
            {fetchesSavedListCount && (
              <>
                {votersAndCostSummary}
                {/* ENG-10808: only worth a second line when the channel
                excludes someone — if the whole list is reachable, "Voters
                selected" above already says the one number that matters.
                A fenced value on either side can coincidentally equal the
                other at the shared FENCE_LIMIT cap without the true
                (uncapped) numbers actually matching, so equality alone
                can't collapse the line unless neither side is fenced. */}
                {!loading &&
                  !hasCountError &&
                  listSize !== null &&
                  (listSize !== count || listSizeFenced || countFenced) && (
                    <div className="px-4 -mt-2 pb-2 text-sm text-muted-foreground text-left">
                      {formatFencedCount(listSize, listSizeFenced)} people in
                      this list
                      <span className="mx-1">·</span>
                      {formatFencedCount(count, countFenced)} reachable by{' '}
                      {reachabilityChannelLabel}
                    </div>
                  )}
                {inlineCountErrorMessage ? (
                  <Alert variant="destructive" className="mb-4 text-left">
                    <MdError />
                    <AlertTitle>Voter data unavailable</AlertTitle>
                    <AlertDescription>
                      {inlineCountErrorMessage}
                    </AlertDescription>
                  </Alert>
                ) : null}
              </>
            )}
          </>
        ) : (
          <>
            {votersAndCostSummary}
            {inlineCountErrorMessage ? (
              <Alert variant="destructive" className="mb-4 text-left">
                <MdError />
                <AlertTitle>Voter data unavailable</AlertTitle>
                <AlertDescription>{inlineCountErrorMessage}</AlertDescription>
              </Alert>
            ) : null}
            <div className="text-left">
              <CustomVoterAudienceFilters
                trackingKey={TRACKING_KEYS.scheduleCampaign}
                showAudienceRequest
                audience={audience}
                onChangeCallback={handleChangeAudience}
              />
            </div>
          </>
        )}
        <div className="mt-4 grid grid-cols-12 gap-4">
          <div className="col-span-6 text-left mt-6">
            <Button
              size="large"
              variant="neutral"
              onClick={backCallback}
              {...backTrackingAttrs}
            >
              Back
            </Button>
          </div>
          <div className="col-span-6 text-right mt-6">
            <Button
              size="large"
              variant="neutral"
              onClick={handleOnNext}
              disabled={isNextDisabled}
              loading={loading}
              {...nextTrackingAttrs}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
