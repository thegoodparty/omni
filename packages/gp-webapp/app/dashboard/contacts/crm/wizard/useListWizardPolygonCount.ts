import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { extractApiErrorInfo } from 'helpers/extractApiErrorInfo'
import type { GeoJsonShape } from '@goodparty_org/contracts'

const COUNT_DEBOUNCE_MS = 600

const AREA_ERROR_MESSAGE =
  'This area holds too many people to count. Draw a smaller one or narrow the list.'

export interface ListWizardPolygonCountResult {
  count: number | undefined
  // Whether the filters behind the shape match nobody at all. A zero `count`
  // means one of two unrelated things, and only this separates them: an
  // audience that is empty cannot be fixed by moving the boundary, and an
  // audience that exists but falls outside it can be fixed by exactly that.
  audienceEmpty: boolean | undefined
  isLoading: boolean
  // Mirrors useListWizardCount's isStale: true while a payload change is
  // still waiting out the debounce, so a caller gating Save on the count for
  // the CURRENT shape does not act on a superseded one.
  isStale: boolean
  isError: boolean
  errorMessage: string | undefined
}

// The live in-boundary count for a list still being built, the shape's
// counterpart to useListWizardCount. Debounced and keyed the same way, for
// the same reason: the query is keyed on the debounced payload, so a slow
// response for a superseded shape resolves into its own cache entry and can
// never overwrite the number on screen.
export const useListWizardPolygonCount = (
  geoPoly: GeoJsonShape | null,
  filters: Record<string, unknown>,
  enabled: boolean,
): ListWizardPolygonCountResult => {
  const orgSlug = useOrganization()?.slug
  const [debouncedPayload, setDebouncedPayload] = useState({
    geoPoly,
    filters,
  })
  const [isDebouncing, setIsDebouncing] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setIsDebouncing(true)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      setDebouncedPayload({ geoPoly, filters })
      setIsDebouncing(false)
    }, COUNT_DEBOUNCE_MS)
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [geoPoly, filters])

  const previewQuery = useQuery({
    queryKey: ['list-wizard-polygon-count', orgSlug, debouncedPayload],
    queryFn: () =>
      clientRequest('POST /v1/contacts/polygon-preview', {
        geoPoly: debouncedPayload.geoPoly!,
        filters: debouncedPayload.filters,
      }).then((res) => res.data),
    // The debounced shape, not the live one: enabling on the live shape
    // would fire the first request with the previous payload still in the
    // query key.
    enabled: enabled && debouncedPayload.geoPoly !== null,
    refetchOnWindowFocus: false,
  })

  // The only 400 a payload from this UI can earn is the preview's own
  // people cap, and gp-api words that refusal for whoever drew the shape —
  // so it is shown rather than replaced.
  const isCapError =
    previewQuery.error instanceof FetchError &&
    previewQuery.error.status === 400

  return {
    count: previewQuery.data?.count,
    audienceEmpty: previewQuery.data?.audienceEmpty,
    isLoading: previewQuery.isPending || previewQuery.isFetching,
    isStale: isDebouncing,
    isError: previewQuery.isError,
    errorMessage: isCapError
      ? (extractApiErrorInfo((previewQuery.error as FetchError).data).message ??
        AREA_ERROR_MESSAGE)
      : undefined,
  }
}
