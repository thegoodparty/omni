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

// One cached detail per row, shared by the history table's social metric
// ("N platforms") and the details drawer, so opening the drawer after the
// metric resolved costs nothing.
export const useOutreachDetail = (id: number | null, enabled = true) =>
  useQuery({
    queryKey: outreachDetailQueryKey(id ?? -1),
    queryFn: async (): Promise<OutreachDetail> => {
      const { data } = await clientRequest('GET /v1/outreach/:id', {
        id: String(id),
      })
      return data
    },
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
