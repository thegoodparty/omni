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
} from 'app/dashboard/voter-records/components/CustomVoterAudienceFilters'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clientRequest } from 'gpApi/typed-request'
import {
  countVoterFile,
  CountVoterFileError,
} from 'app/dashboard/voter-records/[type]/components/RecordCount'
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

const TEXT_PRICE = 0.035
const CALL_PRICE = 0.04
const CALL_W_VOICEMAIL_PRICE = 0.055

const NEW_FROM_FILTERS = '__new__'

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

interface AudienceStepProps {
  onChangeCallback: (
    keyOrData:
      | string
      | {
          voterFileFilter?: VoterFileFilterResult
          phoneListToken: string | null | undefined
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
}: AudienceStepProps): React.JSX.Element {
  const [campaign] = useCampaign()
  const { p2pUxEnabled } = useP2pUxEnabled()
  const [count, setCount] = useState(0)
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

  const [savedLists, setSavedLists] = useState<SavedList[]>([])
  // Empty string = "build a new audience from the checkboxes" (the default).
  const [selectedListId, setSelectedListId] = useState('')

  const selectedList = useMemo(
    () =>
      selectedListId === '' || selectedListId === NEW_FROM_FILTERS
        ? null
        : (savedLists.find((l) => l.id.toString() === selectedListId) ?? null),
    [selectedListId, savedLists],
  )

  useEffect(() => {
    if (!isTextType) return
    let active = true
    clientRequest('GET /v1/voters/voter-file/filters', {})
      .then(({ data }) => {
        if (!active) return
        setSavedLists(
          (data || []).filter(
            (list): list is SavedList =>
              typeof list?.name === 'string' &&
              !AUTO_VOTER_FILTER_NAME_PATTERN.test(list.name),
          ),
        )
      })
      .catch(() => {
        // A failed list fetch must not block the build-new-from-checkboxes
        // path — the selector just stays empty.
        if (active) setSavedLists([])
      })
    return () => {
      active = false
    }
  }, [isTextType])

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
      setCountError(null)
      setCount(0)
      setLoading(false)
      onChangeCallback('voterCount', 0)
      return
    }

    if (!hasValues) {
      setCountError(null)
      setCount(0)
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
        onChangeCallback('voterCount', res)
      } else {
        setCountError(res)
        setCount(0)
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
  }, [audience, isCustom, type, hasValues, selectedList, onChangeCallback])

  const handleChangeAudience = (newState: AudienceFiltersState) => {
    onChangeCallback('audience', newState)
  }

  const handleSelectList = useCallback((value: string) => {
    setSelectedListId(value === NEW_FROM_FILTERS ? '' : value)
  }, [])

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
  const isNextDisabled = selectedList
    ? loading
    : !hasValues || loading || hasCountError || (hasValues && count === 0)

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
        {isTextType && savedLists.length > 0 && (
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
          <div className="p-4 text-sm text-muted-foreground">
            Using your saved list:{' '}
            <span className="font-bold text-black">{selectedList.name}</span>
          </div>
        ) : (
          <>
            <div className="p-4 text-sm">
              Voters selected:
              <span className="font-bold text-black ml-1">
                {loading ? (
                  <LoaderCircleIcon
                    size={14}
                    className="inline-block align-middle animate-spin"
                  />
                ) : (
                  numberFormatter(count)
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
