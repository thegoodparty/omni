'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { OutreachDetail } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'

// Shared so callers that write outside a single detail's cache entry (e.g. a
// calling session that never mounts this hook) can invalidate the whole
// family with one prefix match instead of duplicating the string literal.
export const outreachDetailQueryPrefix = ['outreach-detail']

export const outreachDetailQueryKey = (id: number) => [
  ...outreachDetailQueryPrefix,
  id,
]

// A caller-supplied fetcher parametrizes which network the detail read hits —
// the same bound-function pattern SocialFlow's `surface.endpoints` uses, so
// the history table and drawer never fork per surface.
export type OutreachDetailFetcher = (id: number) => Promise<OutreachDetail>

// Win's campaign-scoped detail read — the default, unchanged from the
// pre-parametrization behavior.
export const fetchOutreachDetail: OutreachDetailFetcher = async (id) => {
  const { data } = await clientRequest('GET /v1/outreach/:id', {
    id: String(id),
  })
  return data
}

// Serve's org-scoped sibling (ENG-10970) — threaded in by the
// constituent-outreach page.
export const fetchServeOutreachDetail: OutreachDetailFetcher = async (id) => {
  const { data } = await clientRequest('GET /v1/outreach/serve/:id', {
    id: String(id),
  })
  return data
}

// One cached detail per row, shared by the history table's social metric
// ("N platforms") and the details drawer, so opening the drawer after the
// metric resolved costs nothing.
export const useOutreachDetail = (
  id: number | null,
  enabled = true,
  fetchDetail: OutreachDetailFetcher = fetchOutreachDetail,
) =>
  useQuery({
    queryKey: outreachDetailQueryKey(id ?? -1),
    queryFn: () => fetchDetail(id as number),
    enabled: enabled && id !== null,
    staleTime: 5 * 60 * 1000,
  })

export const useSeedOutreachDetail = () => {
  const queryClient = useQueryClient()
  // The save response is the created row's full detail — seed the cache so
  // the new history row's metric and drawer never refetch what we already
  // hold.
  return (detail: OutreachDetail) =>
    queryClient.setQueryData(outreachDetailQueryKey(detail.id), detail)
}
