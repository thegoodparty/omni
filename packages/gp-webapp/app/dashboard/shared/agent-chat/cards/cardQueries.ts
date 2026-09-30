import { queryOptions } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { clientRequest } from 'gpApi/typed-request'
import type { SegmentResponse } from 'app/dashboard/contacts/crm/shared/contacts-types'
import { fetchListDetailThrottled } from 'app/dashboard/contacts/crm/lists/useListRowDetail'
import { AUTO_VOTER_FILTER_NAME_PATTERN } from 'app/dashboard/outreach/util/autoVoterFilterName.util'
import {
  outreachAudienceListsKey,
  type ReachabilityKey,
} from 'app/dashboard/outreach/v2/audience/useOutreachAudience'

export const proposalOutreachQueryKey = (proposalKey: string) =>
  ['chat-card-proposal-outreach', proposalKey] as const

/**
 * Nothing found means nothing sent yet, so a 404 resolves to null instead of
 * throwing. `retry: false` because the default config retries twice, and
 * waiting out two backoffs to learn "not sent" is the common path.
 */
export const proposalOutreachQueryOptions = (proposalKey: string) =>
  queryOptions({
    queryKey: proposalOutreachQueryKey(proposalKey),
    retry: false,
    queryFn: async () => {
      try {
        const res = await clientRequest(
          'GET /v1/outreach/by-proposal-key/:proposalKey',
          { proposalKey },
        )
        return res.data
      } catch (error) {
        if (error instanceof FetchError && error.status === 404) return null
        throw error
      }
    },
  })

// Priorities is a Serve surface, so the org-scoped read is the only correct
// one here: the campaign-scoped sibling would 404 for an org with no campaign.
export const pastOutreachQueryOptions = (outreachId: number) =>
  queryOptions({
    queryKey: ['chat-card-past-outreach', outreachId] as const,
    queryFn: () =>
      clientRequest('GET /v1/outreach/serve/:id', {
        id: String(outreachId),
      }).then((res) => res.data),
  })

/**
 * The office's saved lists, on the SAME key the outreach flows' audience step
 * uses — so the CRM's rename/delete/duplicate mutations, which already
 * invalidate that key, reach this picker too, and several cards in one thread
 * share one read. The name filter is that step's as well: an unnamed row and a
 * per-send throwaway are not lists the official built.
 */
export const savedListsQueryOptions = (orgSlug: string | undefined) =>
  queryOptions({
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
    staleTime: 0,
  })

/**
 * How many of a list this channel can actually reach, keyed and shaped like
 * the audience step's own read so the two cannot disagree. The fetch goes
 * through `fetchListDetailThrottled` rather than the endpoint directly: each
 * call costs four people-db aggregates, and the throttle is what keeps a
 * thread full of cards from pushing them past the statement timeout.
 */
export const listReachQueryOptions = (
  orgSlug: string | undefined,
  reachabilityKey: ReachabilityKey | null,
  listId: number | null,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: [
      'outreach-audience-reachability',
      orgSlug,
      reachabilityKey,
      listId,
    ] as const,
    queryFn: async ({ signal }) => {
      // Guarded by `enabled`; narrow rather than cast so a change to that
      // condition cannot quietly pass a null through.
      if (listId === null || reachabilityKey === null) {
        throw new Error('No list selected')
      }
      const detail = await fetchListDetailThrottled(listId, signal)
      return {
        reachable: detail.reachability[reachabilityKey],
        total: detail.demographics.people,
      }
    },
    enabled: enabled && listId !== null && reachabilityKey !== null,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 0,
  })

export const cardContactQueryOptions = (contactId: string) =>
  queryOptions({
    queryKey: ['chat-card-contact', contactId] as const,
    queryFn: () =>
      clientRequest('GET /v1/contacts/:id', { id: contactId }).then(
        (res) => res.data,
      ),
  })
