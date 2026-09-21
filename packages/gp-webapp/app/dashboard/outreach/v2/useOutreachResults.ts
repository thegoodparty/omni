'use client'

import { useQuery } from '@tanstack/react-query'
import type {
  SmsOutreachReplies,
  SmsOutreachResults,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'

// The same bound-function pattern useOutreachDetail uses: the caller decides
// which network the read hits, so the drawer and the history table never
// fork per surface.
export type SmsResultsFetcher = (id: number) => Promise<SmsOutreachResults>

export const smsResultsQueryKey = (id: number) => ['outreach-results', id]

// Win's campaign-scoped read — the default, unchanged.
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

export const useSmsResults = (
  id: number | null,
  enabled: boolean,
  fetchResults: SmsResultsFetcher = fetchSmsResults,
) =>
  useQuery({
    queryKey: smsResultsQueryKey(id ?? -1),
    queryFn: () => fetchResults(id as number),
    enabled: enabled && id !== null,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })

// The reply list is Serve-only and has no Win sibling to default to: reply
// CONTENT exists only for sends that came back through the shared ingest,
// which is the Serve fulfilment path. Win's inbound sweep records reply and
// opt-out timestamps and never a body.
export const smsRepliesQueryKey = (id: number, limit: number) => [
  'outreach-replies',
  id,
  limit,
]

export const useServeSmsReplies = (
  id: number | null,
  enabled: boolean,
  limit: number,
) =>
  useQuery({
    queryKey: smsRepliesQueryKey(id ?? -1, limit),
    queryFn: async (): Promise<SmsOutreachReplies> => {
      const { data } = await clientRequest(
        'GET /v1/outreach/serve/:id/replies',
        { id: String(id), limit },
      )
      return data
    },
    enabled: enabled && id !== null,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
