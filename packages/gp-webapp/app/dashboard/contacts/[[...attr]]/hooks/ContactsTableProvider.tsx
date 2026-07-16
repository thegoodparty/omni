'use client'

import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  ReactNode,
} from 'react'
import {
  useRouter,
  useSearchParams,
  usePathname,
  useParams,
} from 'next/navigation'
import {
  useQuery,
  useInfiniteQuery,
  queryOptions,
  useQueryClient,
} from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { clientRequest } from 'gpApi/typed-request'
import { extractApiErrorInfo } from 'helpers/extractApiErrorInfo'
import {
  type Person,
  type ConstituentIssue,
  type ConstituentActivity,
  type ListContactsResponse,
  type SegmentResponse,
} from '../components/shared/contacts-types'
import {
  DEFAULT_PAGE_SIZE,
  ALL_SEGMENTS,
  VOTER_DATA_UNAVAILABLE_ERROR_CODE,
} from '../components/shared/constants'
import defaultSegments from '../components/configs/defaultSegments.config'
import {
  isCustomSegment,
  findCustomSegment,
} from '../components/shared/segments.util'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useElectedOffice } from '@shared/hooks/useElectedOffice'
import { useOrganization } from '@shared/organization-picker'
import { useWinVoterContext } from '../../../shared/useWinVoterContext'

const extractPersonIdFromParams = (
  params: ReturnType<typeof useParams> | null,
): string | null => {
  if (!params?.attr) return null

  const attrArray = Array.isArray(params.attr) ? params.attr : [params.attr]
  if (attrArray.length !== 1) return null

  const personId = attrArray[0]
  if (personId && typeof personId === 'string' && personId.trim().length > 0) {
    return personId
  }

  return null
}

export interface CurrentlySelectedPerson {
  person: Person | null
  isLoadingPerson: boolean
  isErrorPerson: boolean
  issues: ConstituentIssue[]
  isLoadingIssues: boolean
  isErrorIssues: boolean
  issuesHasNextPage: boolean
  issuesFetchNextPage: () => void
  isFetchingNextIssues: boolean
  activities: ConstituentActivity[]
  isLoadingActivities: boolean
  isErrorActivities: boolean
  activitiesHasNextPage: boolean
  activitiesFetchNextPage: () => void
  isFetchingNextActivities: boolean
}

interface ContactsTableState {
  filteredContacts: Person[]
  currentlySelectedPersonId: string | null
  currentlySelectedPerson: CurrentlySelectedPerson
  segments: typeof defaultSegments
  customSegments: SegmentResponse[]
  currentSegment: string
  searchTerm: string
  urlQueryParams: URLSearchParams
  pagination: ListContactsResponse['pagination'] | null
  isLoading: boolean
  isVoterDataUnavailable: boolean
  isCustomSegment: boolean
  totalSegmentContacts: number
  canUseProFeatures: boolean
  isElectedOfficial: boolean
  isWinContext: boolean
  isWinContextReady: boolean
}

interface ContactsTableActions {
  pageUp: () => void
  pageDown: () => void
  goToPage: (page: number) => void
  setPageSize: (pageSize: number) => void
  selectPerson: (personId: string | number | null) => void
  selectSegment: (segment: string) => void
  searchContacts: (query: string) => void
  refreshCustomSegments: () => Promise<void>
}

type ContactsTableContextValue = ContactsTableState & ContactsTableActions

const ContactsTableContext = createContext<ContactsTableContextValue | null>(
  null,
)

export const useContactsTable = (): ContactsTableContextValue => {
  const context = useContext(ContactsTableContext)
  if (!context) {
    throw new Error(
      'useContactsTable must be used within ContactsTableProvider',
    )
  }
  return context
}

interface ContactsTableProviderProps {
  children: ReactNode
}

const contactTableQueryOptions = (params: {
  orgSlug: string | undefined
  page: number
  resultsPerPage: number
  segment: string
  search?: string
}) =>
  queryOptions({
    queryKey: ['contacts', params],
    queryFn: () =>
      clientRequest('GET /v1/contacts', {
        page: params.page || 1,
        resultsPerPage: params.resultsPerPage || DEFAULT_PAGE_SIZE,
        segment: params.segment || ALL_SEGMENTS,
        ...(params.search ? { search: params.search } : {}),
      }).then((res) => res.data),
    refetchOnMount: false,
    // Contacts 4xx are deterministic (VOTER_DATA_UNAVAILABLE / not-pro = 400,
    // flag-off = 403); retrying just makes ineligible users wait through the
    // global 2-retry backoff before the ineligible state renders, and the
    // page+1 prefetch doubles the wasted requests. Keep the global budget for
    // everything else (5xx, network).
    retry: (failureCount, error) =>
      !(
        error instanceof FetchError &&
        typeof error.status === 'number' &&
        error.status >= 400 &&
        error.status < 500
      ) && failureCount < 2,
  })

export const ContactsTableProvider = ({
  children,
}: ContactsTableProviderProps) => {
  const router = useRouter()

  const [campaign] = useCampaign()
  // All contacts/person/segment data is org-scoped: gpFetch sends the active
  // org's slug as X-Organization-Slug from the cookie. The slug is in every
  // query key below so a Win org can never read a Serve org's cached rows or
  // detail when the active org changes outside the org picker (ENG-10511).
  const orgSlug = useOrganization()?.slug
  const { data: electedOffice } = useElectedOffice()
  // Single source of the Win-vs-Serve decision (shared with the menu, mobile
  // title, and page copy). Picks the engagement :id below and the page labels.
  const { isWin: isWinContext, isReady: isWinContextReady } =
    useWinVoterContext()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const params = useParams()

  const segments = defaultSegments

  const canUseProFeatures = useMemo(() => {
    return !!campaign?.isPro || !!electedOffice
  }, [campaign, electedOffice])
  const isElectedOfficial = useMemo(() => {
    return !!electedOffice
  }, [electedOffice])

  const urlQueryParams = useMemo(() => {
    return new URLSearchParams(searchParams?.toString() || '')
  }, [searchParams])

  const currentSegment = useMemo(() => {
    return searchParams?.get('segment') || ALL_SEGMENTS
  }, [searchParams])

  const searchTerm = useMemo(() => {
    return searchParams?.get('query') || ''
  }, [searchParams])

  const currentPage = useMemo(() => {
    return parseInt(searchParams?.get('page') || '1', 10)
  }, [searchParams])

  const pageSize = useMemo(() => {
    return parseInt(
      searchParams?.get('pageSize') || String(DEFAULT_PAGE_SIZE),
      10,
    )
  }, [searchParams])

  const currentlySelectedPersonId = useMemo(
    () => extractPersonIdFromParams(params),
    [params],
  )

  const contactsQuery = useQuery(
    contactTableQueryOptions({
      orgSlug,
      page: currentPage,
      resultsPerPage: pageSize,
      segment: currentSegment,
      search: searchTerm,
    }),
  )

  // Prefetch the next page, but only once we know there is one. Without this
  // guard the prefetch fires a second /v1/contacts request on every view —
  // including the last page, where page+1 has no results — doubling the list
  // request volume for no benefit.
  useQuery({
    ...contactTableQueryOptions({
      orgSlug,
      page: currentPage + 1,
      resultsPerPage: pageSize,
      segment: currentSegment,
      search: searchTerm,
    }),
    enabled: !!contactsQuery.data?.pagination?.hasNextPage,
  })

  const personQuery = useQuery({
    queryKey: ['person', orgSlug, currentlySelectedPersonId],
    queryFn: () =>
      clientRequest('GET /v1/contacts/:id', {
        id: currentlySelectedPersonId!,
      }).then((res) => res.data),
    enabled: Boolean(currentlySelectedPersonId),
  })

  const issuesInfiniteQuery = useInfiniteQuery({
    queryKey: [
      'contact-engagement',
      'issues',
      orgSlug,
      currentlySelectedPersonId,
    ],
    queryFn: ({ pageParam }) =>
      clientRequest('GET /v1/contact-engagement/:id/issues', {
        id: currentlySelectedPersonId!,
        take: 3,
        ...(pageParam ? { after: pageParam } : {}),
      }).then((res) => res.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    enabled: Boolean(currentlySelectedPersonId),
  })

  // The campaign engagement endpoint keys activities on the durable lalVoterId
  // for Win, but on person.id for the Serve/elected-office path (task 12
  // contract). lalVoterId comes from the person fetch, so the query waits on it
  // before firing. isWinContext (from useWinVoterContext) reads false until the
  // elected-office load settles, so it can't briefly mistake a Serve user for
  // Win and fire against the wrong endpoint. PersonOverlay's activity feed reads
  // this from context rather than recomputing.
  const activitiesEngagementId = isWinContext
    ? (personQuery.data?.lalVoterId ?? null)
    : currentlySelectedPersonId

  const activitiesInfiniteQuery = useInfiniteQuery({
    queryKey: [
      'contact-engagement',
      'activities',
      orgSlug,
      activitiesEngagementId,
    ],
    queryFn: ({ pageParam }) =>
      clientRequest('GET /v1/contact-engagement/:id/activities', {
        id: activitiesEngagementId!,
        take: 2,
        ...(pageParam ? { after: pageParam } : {}),
      }).then((res) => res.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    enabled: Boolean(activitiesEngagementId),
  })

  const customSegmentsQuery = useQuery({
    queryKey: ['custom-segments', orgSlug],
    queryFn: () =>
      clientRequest('GET /v1/voters/voter-file/filters', {}).then(
        (res) => res.data,
      ),
  })

  const filteredContacts = useMemo(
    () => (contactsQuery.data?.people as Person[]) || [],
    [contactsQuery.data],
  )

  const pagination = useMemo(
    () => contactsQuery.data?.pagination || null,
    [contactsQuery.data],
  )

  const issuesFlattened = useMemo(
    () => issuesInfiniteQuery.data?.pages.flatMap((p) => p.results) ?? [],
    [issuesInfiniteQuery.data?.pages],
  )

  const activitiesFlattened = useMemo(
    () => activitiesInfiniteQuery.data?.pages.flatMap((p) => p.results) ?? [],
    [activitiesInfiniteQuery.data?.pages],
  )

  const currentlySelectedPerson = useMemo<CurrentlySelectedPerson>(
    () => ({
      person: personQuery.data ?? null,
      isLoadingPerson: personQuery.isLoading || personQuery.isFetching,
      isErrorPerson: personQuery.isError ?? false,
      issues: issuesFlattened,
      isLoadingIssues:
        issuesInfiniteQuery.isLoading ||
        (issuesInfiniteQuery.isFetching && issuesFlattened.length === 0),
      isErrorIssues: issuesInfiniteQuery.isError ?? false,
      issuesHasNextPage: issuesInfiniteQuery.hasNextPage ?? false,
      issuesFetchNextPage: issuesInfiniteQuery.fetchNextPage,
      isFetchingNextIssues: issuesInfiniteQuery.isFetchingNextPage ?? false,
      activities: activitiesFlattened,
      isLoadingActivities:
        activitiesInfiniteQuery.isLoading ||
        (activitiesInfiniteQuery.isFetching &&
          activitiesFlattened.length === 0),
      isErrorActivities: activitiesInfiniteQuery.isError ?? false,
      activitiesHasNextPage: activitiesInfiniteQuery.hasNextPage ?? false,
      activitiesFetchNextPage: activitiesInfiniteQuery.fetchNextPage,
      isFetchingNextActivities:
        activitiesInfiniteQuery.isFetchingNextPage ?? false,
    }),
    [
      personQuery.data,
      personQuery.isLoading,
      personQuery.isFetching,
      personQuery.isError,
      issuesFlattened,
      issuesInfiniteQuery.isLoading,
      issuesInfiniteQuery.isFetching,
      issuesInfiniteQuery.isError,
      issuesInfiniteQuery.hasNextPage,
      issuesInfiniteQuery.fetchNextPage,
      issuesInfiniteQuery.isFetchingNextPage,
      activitiesFlattened,
      activitiesInfiniteQuery.isLoading,
      activitiesInfiniteQuery.isFetching,
      activitiesInfiniteQuery.isError,
      activitiesInfiniteQuery.hasNextPage,
      activitiesInfiniteQuery.fetchNextPage,
      activitiesInfiniteQuery.isFetchingNextPage,
    ],
  )

  const customSegments = useMemo(
    () => customSegmentsQuery.data || [],
    [customSegmentsQuery.data],
  )

  const isCustomSegmentValue = useMemo(() => {
    return isCustomSegment(customSegments, currentSegment)
  }, [customSegments, currentSegment])

  const totalSegmentContacts = useMemo(() => {
    return pagination?.totalResults || 0
  }, [pagination])

  const isLoading = contactsQuery.isLoading || contactsQuery.isFetching

  // A Win campaign with no resolvable district (or that fails the
  // federal/state download-access rule) gets a 400 with this error code from
  // gp-api. Surface it as a clean ineligible state instead of a generic error.
  const isVoterDataUnavailable = useMemo(() => {
    const error = contactsQuery.error
    if (!(error instanceof FetchError)) return false
    return (
      extractApiErrorInfo(error.data).errorCode ===
      VOTER_DATA_UNAVAILABLE_ERROR_CODE
    )
  }, [contactsQuery.error])

  const updateURL = useCallback(
    (updates: Record<string, string | number | null | undefined>) => {
      const params = new URLSearchParams(searchParams?.toString() || '')

      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') {
          params.delete(key)
        } else {
          params.set(key, String(value))
        }
      })

      const newUrl = `${pathname}${
        params.toString() ? `?${params.toString()}` : ''
      }`
      router.push(newUrl, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  const queryClient = useQueryClient()

  // Depend on the stable `refetch` rather than the whole query object: the
  // useQuery result is a new reference every render, so keying on it would make
  // this callback (and therefore the context value) churn on every render.
  const refetchCustomSegments = customSegmentsQuery.refetch
  const refreshCustomSegments = useCallback(async () => {
    await refetchCustomSegments()
    queryClient.invalidateQueries({ queryKey: ['contacts'] })
  }, [refetchCustomSegments, queryClient])

  const pageUp = useCallback(() => {
    if (pagination?.hasNextPage) {
      updateURL({ page: currentPage + 1 })
    }
  }, [pagination, currentPage, updateURL])

  const pageDown = useCallback(() => {
    if (pagination?.hasPreviousPage) {
      updateURL({ page: currentPage - 1 })
    }
  }, [pagination, currentPage, updateURL])

  const goToPage = useCallback(
    (page: number) => {
      const totalPages = pagination?.totalPages || 1
      const targetPage = Math.max(1, Math.min(page, totalPages))
      updateURL({ page: targetPage })
    },
    [pagination, updateURL],
  )

  const setPageSize = useCallback(
    (newPageSize: number) => {
      updateURL({ pageSize: newPageSize, page: 1 })
    },
    [updateURL],
  )

  const selectPerson = useCallback(
    (personId: string | number | null) => {
      const basePath = '/dashboard/contacts'
      const currentParams = new URLSearchParams(searchParams?.toString() || '')
      const queryString = currentParams.toString()
        ? `?${currentParams.toString()}`
        : ''

      const path =
        personId === null ? basePath : `${basePath}/${String(personId)}`

      router.push(`${path}${queryString}`, { scroll: false })
    },
    [router, searchParams],
  )

  const selectSegment = useCallback(
    (segment: string) => {
      // A list saved from a search result set stores its search term; selecting
      // it must reproduce the searched-down view, so re-apply (or clear) the
      // query param alongside the segment. Built-in/default segments and lists
      // saved without a search clear it (ENG-10518).
      const savedSearch = findCustomSegment(customSegments, segment)?.search
      updateURL({ segment, page: 1, query: savedSearch ?? null })
    },
    [updateURL, customSegments],
  )

  const searchContactsAction = useCallback(
    (query: string) => {
      if (query.trim()) {
        updateURL({ query: query, page: 1 })
      } else {
        updateURL({ query: null })
      }
    },
    [updateURL],
  )

  // The provider re-renders on every keystroke and URL change. A fresh object
  // literal here would be a new reference each render, forcing every consumer
  // of the context to re-render regardless of whether the slice it reads
  // actually changed — defeating the useMemo/useCallback on the members below.
  // Memoize on the members themselves (all already stable references) so the
  // value only changes when something a consumer can observe changes.
  const value = useMemo<ContactsTableContextValue>(
    () => ({
      filteredContacts,
      currentlySelectedPersonId,
      currentlySelectedPerson,
      segments,
      customSegments,
      currentSegment,
      searchTerm,
      urlQueryParams,
      pagination,
      isLoading,
      isVoterDataUnavailable,
      isCustomSegment: isCustomSegmentValue,
      totalSegmentContacts,
      canUseProFeatures,
      isElectedOfficial,
      isWinContext,
      isWinContextReady,
      pageUp,
      pageDown,
      goToPage,
      setPageSize,
      selectPerson,
      selectSegment,
      searchContacts: searchContactsAction,
      refreshCustomSegments,
    }),
    [
      filteredContacts,
      currentlySelectedPersonId,
      currentlySelectedPerson,
      segments,
      customSegments,
      currentSegment,
      searchTerm,
      urlQueryParams,
      pagination,
      isLoading,
      isVoterDataUnavailable,
      isCustomSegmentValue,
      totalSegmentContacts,
      canUseProFeatures,
      isElectedOfficial,
      isWinContext,
      isWinContextReady,
      pageUp,
      pageDown,
      goToPage,
      setPageSize,
      selectPerson,
      selectSegment,
      searchContactsAction,
      refreshCustomSegments,
    ],
  )

  return (
    <ContactsTableContext.Provider value={value}>
      {children}
    </ContactsTableContext.Provider>
  )
}
