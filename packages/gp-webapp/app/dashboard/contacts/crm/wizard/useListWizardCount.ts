import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { extractApiErrorInfo } from 'helpers/extractApiErrorInfo'

const COUNT_DEBOUNCE_MS = 600

const CAP_ERROR_MESSAGE =
  'This selection matches too many people to build directly — narrow your filters and try again.'

export interface ListWizardCountResult {
  count: number | undefined
  isLoading: boolean
  isError: boolean
  isCapError: boolean
  errorMessage: string | undefined
}

// Debounced live running-total for the list wizard's build button, mirroring
// FiltersSheet's ENG-10517 count pattern: the query is keyed on the debounced
// payload, so a slower response for a superseded payload resolves into its
// own cache entry and can never overwrite the currently-rendered total
// (same guarantee the typeahead's request-sequencing relies on).
export const useListWizardCount = (
  payload: Record<string, unknown>,
  enabled: boolean,
): ListWizardCountResult => {
  const orgSlug = useOrganization()?.slug
  const [debouncedPayload, setDebouncedPayload] = useState(payload)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      setDebouncedPayload(payload)
    }, COUNT_DEBOUNCE_MS)
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [payload])

  const countQuery = useQuery({
    queryKey: ['list-wizard-count', orgSlug, debouncedPayload],
    queryFn: () =>
      clientRequest('POST /v1/contacts/count', debouncedPayload).then(
        (res) => res.data.count,
      ),
    enabled,
    // The count is an at-a-glance affordance while building; a window-focus
    // refetch mid-build would be disruptive and waste a query (same reasoning
    // as FiltersSheet's countQuery).
    refetchOnWindowFocus: false,
  })

  // The only 400 this endpoint can return for a payload our own UI produces
  // is the activity-condition/support-status resolver's 100k id-set cap
  // (activityConditionResolution.service.ts's assertUnderCap) — non-pro
  // access is impossible here because the wizard itself is pro-gated, and
  // our UI never constructs an invalid outreachType/outreachId/door-knock
  // combination. So any 400 on this query is the cap, safe to map generically.
  const isCapError =
    countQuery.error instanceof FetchError && countQuery.error.status === 400

  return {
    count: countQuery.data,
    isLoading: countQuery.isPending || countQuery.isFetching,
    isError: countQuery.isError,
    isCapError,
    errorMessage: isCapError
      ? (extractApiErrorInfo((countQuery.error as FetchError).data).message ??
        CAP_ERROR_MESSAGE)
      : undefined,
  }
}
