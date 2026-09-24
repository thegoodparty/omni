'use client'

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  SMS_OUTREACH_REPLIES_DEFAULT_LIMIT,
  SMS_OUTREACH_REPLIES_MAX_LIMIT,
  type SmsOutreachReplies,
  type SmsOutreachResults,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'

/**
 * Which product's network a results read hits.
 *
 * A string rather than a bound fetcher (the shape `useOutreachDetail` uses)
 * because the CACHE KEY has to carry the scope too, and a fetcher alone
 * cannot. Win and Serve share one QueryClient per browser session and draw
 * ids from the same auto-increment `outreach` table, so a key of
 * ['outreach-results', id] lets whichever surface resolves first answer for
 * the other until gcTime expires — silently, with no network hit. One
 * argument picks both the key segment and the fetcher, so the two can never
 * be threaded inconsistently.
 */
export type OutreachResultsSurface = 'win' | 'serve'

export type SmsResultsFetcher = (id: number) => Promise<SmsOutreachResults>

export const smsResultsQueryKey = (
  surface: OutreachResultsSurface,
  id: number,
) => ['outreach-results', surface, id]

// Win's campaign-scoped read.
export const fetchSmsResults: SmsResultsFetcher = async (id) => {
  const { data } = await clientRequest('GET /v1/outreach/:id/results', {
    id: String(id),
  })
  return data
}

// Serve's org-scoped sibling.
export const fetchServeSmsResults: SmsResultsFetcher = async (id) => {
  const { data } = await clientRequest('GET /v1/outreach/serve/:id/results', {
    id: String(id),
  })
  return data
}

const SMS_RESULTS_FETCHERS: Record<OutreachResultsSurface, SmsResultsFetcher> =
  {
    win: fetchSmsResults,
    serve: fetchServeSmsResults,
  }

export const useSmsResults = (
  id: number | null,
  enabled: boolean,
  surface: OutreachResultsSurface,
) =>
  useQuery({
    queryKey: smsResultsQueryKey(surface, id ?? -1),
    queryFn: () => SMS_RESULTS_FETCHERS[surface](id as number),
    enabled: enabled && id !== null,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })

// The reply list is Serve-only and has no Win sibling to default to: reply
// CONTENT exists only for sends that came back through the shared ingest,
// which is the Serve fulfilment path. Win's inbound sweep records reply and
// opt-out timestamps and never a body. The key still names the surface, so
// the family reads consistently if a Win sibling ever appears.
export const smsRepliesQueryKey = (id: number) => [
  'outreach-replies',
  'serve',
  id,
]

/**
 * Offset-paged so every reply is reachable.
 *
 * The first page is the design's collapsed ten; each page after it takes the
 * server's ceiling, so a send with hundreds of replies finishes in one more
 * fetch rather than dozens. The offset is the running count of what has been
 * loaded, which is exact because the order is stable (sentAt desc, then id).
 *
 * A growing `limit` on a plain useQuery cannot do this: the server clamps at
 * SMS_OUTREACH_REPLIES_MAX_LIMIT, so anything past position 200 would be
 * unreachable while the header went on naming the full total.
 */
export const useServeSmsReplies = (id: number | null, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: smsRepliesQueryKey(id ?? -1),
    queryFn: async ({ pageParam }): Promise<SmsOutreachReplies> => {
      const { data } = await clientRequest(
        'GET /v1/outreach/serve/:id/replies',
        {
          id: String(id),
          limit:
            pageParam === 0
              ? SMS_OUTREACH_REPLIES_DEFAULT_LIMIT
              : SMS_OUTREACH_REPLIES_MAX_LIMIT,
          offset: pageParam,
        },
      )
      return data
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce(
        (count, page) => count + page.replies.length,
        0,
      )
      // A page that came back short of what it asked for means the send is
      // exhausted, whatever `total` claims — stop rather than spin on an
      // offset the server will keep answering empty.
      if (lastPage.replies.length === 0) return undefined
      return loaded < lastPage.total ? loaded : undefined
    },
    enabled: enabled && id !== null,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
