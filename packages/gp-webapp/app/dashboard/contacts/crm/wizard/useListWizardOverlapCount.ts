import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'

const OVERLAP_DEBOUNCE_MS = 600

export interface ListWizardOverlapCountResult {
  count: number | undefined
  isLoading: boolean
  // True while a payload change is still waiting out the debounce — mirrors
  // useListWizardCount's isStale (ENG-10517 pattern): the strip must not
  // render a number for a superseded selection.
  isStale: boolean
  isError: boolean
}

// Debounced saved-list overlap count for the wizard's "N (P%) voters already
// exist in lists you've saved" strip (ENG-10840). Keyed on its own query (not
// the live count's) so a slow/superseded response can never overwrite the
// currently-rendered overlap — same guarantee useListWizardCount relies on.
export const useListWizardOverlapCount = (
  payload: Record<string, unknown>,
  enabled: boolean,
): ListWizardOverlapCountResult => {
  const orgSlug = useOrganization()?.slug
  const [debouncedPayload, setDebouncedPayload] = useState(payload)
  const [isDebouncing, setIsDebouncing] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setIsDebouncing(true)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      setDebouncedPayload(payload)
      setIsDebouncing(false)
    }, OVERLAP_DEBOUNCE_MS)
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [payload])

  const overlapQuery = useQuery({
    queryKey: ['contacts-overlap', orgSlug, debouncedPayload],
    queryFn: () =>
      clientRequest('POST /v1/contacts/overlap-count', debouncedPayload).then(
        (res) => res.data,
      ),
    enabled,
    // Mirrors useListWizardCount: an at-a-glance affordance while building,
    // not something that should refetch on an incidental window refocus.
    refetchOnWindowFocus: false,
  })

  return {
    count: overlapQuery.data?.count,
    isLoading: overlapQuery.isPending || overlapQuery.isFetching,
    isStale: isDebouncing,
    isError: overlapQuery.isError,
  }
}
