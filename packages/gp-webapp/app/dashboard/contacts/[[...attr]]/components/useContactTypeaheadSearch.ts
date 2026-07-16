import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import type { Person } from './shared/contacts-types'

export const MIN_TYPEAHEAD_QUERY_LENGTH = 3
const DEBOUNCE_MS = 300
const TYPEAHEAD_RESULTS_PER_PAGE = 8

interface ContactTypeaheadSearch {
  results: Person[]
  isLoading: boolean
  isEmpty: boolean
  isError: boolean
}

export const useContactTypeaheadSearch = (
  query: string,
): ContactTypeaheadSearch => {
  const orgSlug = useOrganization()?.slug
  const term = query.trim()
  const isActive = term.length >= MIN_TYPEAHEAD_QUERY_LENGTH
  const [debouncedTerm, setDebouncedTerm] = useState('')

  useEffect(() => {
    if (!isActive) {
      setDebouncedTerm('')
      return
    }
    const timeout = setTimeout(() => setDebouncedTerm(term), DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [term, isActive])

  const searchQuery = useQuery({
    // Keyed on the debounced term (and org, ENG-10511): a slow response for a
    // superseded term resolves into its own cache entry and can never
    // overwrite the current term's rendered results. Deliberately NOT the
    // table's ['contacts', ...] key — the typeahead must never write into the
    // table's cached pages or its URL-driven state.
    queryKey: ['contacts-typeahead', orgSlug, debouncedTerm],
    queryFn: () =>
      clientRequest('GET /v1/contacts', {
        page: 1,
        resultsPerPage: TYPEAHEAD_RESULTS_PER_PAGE,
        search: debouncedTerm,
      }).then((res) => res.data),
    enabled: isActive && debouncedTerm.length >= MIN_TYPEAHEAD_QUERY_LENGTH,
  })

  const isDebouncing = term !== debouncedTerm
  // ENG-10688 seam: `settled` is the single point where a completed search
  // resolves with its result count (settled.people.length). The query key
  // confines stale responses to non-current cache entries, and the
  // isDebouncing guard keeps a superseded term's data from surfacing — so
  // instrumenting here counts each completed, non-stale search exactly once.
  const settled = isActive && !isDebouncing ? searchQuery.data : undefined
  // Without this, a failed request (gp-api 5xx, expired session) leaves
  // `settled` undefined forever and the dropdown spins permanently.
  const isError = isActive && !isDebouncing && searchQuery.isError

  return {
    results: settled?.people ?? [],
    isLoading: isActive && settled === undefined && !isError,
    isEmpty: settled !== undefined && settled.people.length === 0,
    isError,
  }
}
