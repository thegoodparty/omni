import { queryOptions } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'

// A run takes minutes. Five seconds lands the themes promptly once it ends
// without asking for the whole report more than a few dozen times a run.
export const REPORT_POLL_INTERVAL_MS = 5_000

export const reportQueryKey = (outreachId: number) =>
  ['issue-capture', 'report', outreachId] as const

// Polls only while the latest run is in flight, and stops by itself the
// first time the report says it is not.
export const reportQueryOptions = (outreachId: number) =>
  queryOptions({
    queryKey: reportQueryKey(outreachId),
    queryFn: () =>
      clientRequest('GET /v1/constituent-feedback/efforts/:outreachId/report', {
        outreachId: String(outreachId),
      }).then((res) => res.data),
    refetchInterval: (query) =>
      query.state.data?.run?.status === 'running'
        ? REPORT_POLL_INTERVAL_MS
        : false,
  })

// Every effort's review list, for a write that cannot say which effort it
// touched.
export const PENDING_QUERY_KEY_PREFIX = ['issue-capture', 'pending'] as const

export const pendingQueryKey = (outreachId: number) =>
  [...PENDING_QUERY_KEY_PREFIX, outreachId] as const

// The review list. Polls while a memo is still transcribing, which a batch
// job finishes in about a minute, and stops by itself once none is.
export const pendingQueryOptions = (outreachId: number) =>
  queryOptions({
    queryKey: pendingQueryKey(outreachId),
    queryFn: () =>
      clientRequest('GET /v1/constituent-feedback/pending', {
        outreachId,
      }).then((res) => res.data.feedback),
    refetchInterval: (query) =>
      query.state.data?.some((memo) => memo.extractionStatus === 'pending')
        ? REPORT_POLL_INTERVAL_MS
        : false,
  })

export const themeQueryOptions = (themeId: string) =>
  queryOptions({
    queryKey: ['issue-capture', 'theme', themeId] as const,
    queryFn: () =>
      clientRequest('GET /v1/constituent-feedback/themes/:id', {
        id: themeId,
      }).then((res) => res.data),
  })

export const PROPOSED_TAGS_QUERY_KEY = [
  'issue-capture',
  'tags',
  'proposed',
] as const

export const proposedTagsQueryOptions = queryOptions({
  queryKey: PROPOSED_TAGS_QUERY_KEY,
  queryFn: () =>
    clientRequest('GET /v1/constituent-feedback/tags', {
      status: 'proposed',
    }).then((res) => res.data.tags),
  // A 403 is a volunteer, which is an answer rather than a blip to retry.
  retry: false,
  // A run that lands while the page is open proposes new tags, and the strip
  // mounts with the themes it belongs to, so it reads fresh every time.
  staleTime: 0,
})
