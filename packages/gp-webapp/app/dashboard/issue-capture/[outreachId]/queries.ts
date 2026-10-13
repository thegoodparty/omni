import { queryOptions } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'

// A run takes minutes. Five seconds lands the themes promptly once it ends
// without asking for the whole report more than a few dozen times a run.
export const REPORT_POLL_INTERVAL_MS = 5_000

// Every effort's report, for a capture form that cannot say which effort its
// knock or call belongs to.
export const REPORT_QUERY_KEY_PREFIX = ['issue-capture', 'report'] as const

export const reportQueryKey = (outreachId: number) =>
  [...REPORT_QUERY_KEY_PREFIX, outreachId] as const

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

export const themeQueryOptions = (themeId: string) =>
  queryOptions({
    queryKey: ['issue-capture', 'theme', themeId] as const,
    queryFn: () =>
      clientRequest('GET /v1/constituent-feedback/themes/:id', {
        id: themeId,
      }).then((res) => res.data),
  })
