import { useMemo } from 'react'
import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { useDistrictResolution } from '../../../shared/useDistrictResolution'
import { useWinVoterContext } from '../../../shared/useWinVoterContext'
import type { CurrentlySelectedPerson } from '../ContactsTableProvider'

// The person record's own reads (the person, their top issues, their
// activity), keyed as the contacts page keys them, so the record opened from
// any page shares that page's cache.
export const usePersonCard = (
  personId: string | null,
): CurrentlySelectedPerson => {
  const orgSlug = useOrganization()?.slug
  const { isUnresolvable: isDistrictUnresolvable } = useDistrictResolution()
  const { isWin: isWinContext, isReady: isWinContextReady } =
    useWinVoterContext()

  const personQuery = useQuery({
    queryKey: ['person', orgSlug, personId],
    queryFn: () =>
      clientRequest('GET /v1/contacts/:id', {
        id: personId!,
      }).then((res) => res.data),
    // findPerson resolves a district server-side, and the person path is
    // deep-linkable, so this has to be gated independently of the page's branch.
    enabled: !isDistrictUnresolvable && Boolean(personId),
  })

  const issuesInfiniteQuery = useInfiniteQuery({
    queryKey: ['contact-engagement', 'issues', orgSlug, personId],
    queryFn: ({ pageParam }) =>
      clientRequest('GET /v1/contact-engagement/:id/issues', {
        id: personId!,
        take: 3,
        ...(pageParam ? { after: pageParam } : {}),
      }).then((res) => res.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    enabled: Boolean(personId),
  })

  // The contact-engagement endpoint keys activities on personId for both
  // Win and Serve (ENG-10695 — supersedes the old task 12 contract where :id
  // was the durable lalVoterId for campaigns). Win additionally passes
  // lalVoterId, sourced from the person fetch, to bring the legacy
  // VoterOutreachActivity rows into the union during the sunset. lalVoterId
  // is part of the query key, so if it fired early (isWinContext still
  // false during the win-voter-context loading window) with lalVoterId
  // undefined and then flipped once both isWinContext and personQuery
  // resolved, the key change would discard any pages the user already paged
  // into. `enabled` therefore waits for isWinContextReady before evaluating
  // Win vs Serve at all — on mount, isWinContextReady is false regardless of
  // context, and `enabled` must not default to true then, or the query fires
  // once on the stale initial render before either query has a chance to
  // settle. Once ready: Serve fires immediately (never depended on
  // personQuery); Win additionally waits for personQuery to settle
  // (isFetched — success OR error, not just "has data") before firing. This
  // is a wait-for-settle, not a hard success gate — when personQuery errors
  // (e.g. people-api is down), isFetched still goes true, so the feed
  // proceeds with lalVoterId undefined (new-model union only, no legacy
  // rows) rather than deadlocking.
  const winLalVoterId = isWinContext
    ? (personQuery.data?.lalVoterId ?? undefined)
    : undefined

  const activitiesInfiniteQuery = useInfiniteQuery({
    queryKey: [
      'contact-engagement',
      'activities',
      orgSlug,
      personId,
      winLalVoterId,
    ],
    queryFn: ({ pageParam }) =>
      clientRequest('GET /v1/contact-engagement/:id/activities', {
        id: personId!,
        take: 2,
        ...(winLalVoterId ? { lalVoterId: winLalVoterId } : {}),
        ...(pageParam ? { after: pageParam } : {}),
      }).then((res) => res.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    enabled:
      Boolean(personId) &&
      isWinContextReady &&
      (!isWinContext || personQuery.isFetched),
  })

  const issuesFlattened = useMemo(
    () => issuesInfiniteQuery.data?.pages.flatMap((p) => p.results) ?? [],
    [issuesInfiniteQuery.data?.pages],
  )

  const activitiesFlattened = useMemo(
    () => activitiesInfiniteQuery.data?.pages.flatMap((p) => p.results) ?? [],
    [activitiesInfiniteQuery.data?.pages],
  )

  return useMemo<CurrentlySelectedPerson>(
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
}
