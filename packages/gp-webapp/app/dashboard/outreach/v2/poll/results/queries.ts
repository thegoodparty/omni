import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import {
  SMS_OUTREACH_REPLIES_DEFAULT_LIMIT,
  SMS_OUTREACH_REPLIES_MAX_LIMIT,
  type OutreachDetail,
  type PollAnalysisStatus,
  type ReplyFlagUpdate,
  type SmsOutreachReplies,
  type SmsOutreachRepliesFilter,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'

// A run takes a minute or two, and responses land as people reply. Fifteen
// seconds shows both promptly without hammering a page left open.
export const POLL_RESULTS_REFRESH_MS = 15_000

type PollStatus = OutreachDetail['status']

export type PollPhase =
  | 'review'
  | 'scheduled'
  | 'in_progress'
  | 'done'
  | 'closed'

export const pollPhase = (status: PollStatus): PollPhase => {
  switch (status) {
    case 'in_progress':
      return 'in_progress'
    case 'completed':
      return 'done'
    case 'approved':
    case 'paid':
      return 'scheduled'
    case 'denied':
    case 'canceled':
    case 'failed':
      return 'closed'
    default:
      return 'review'
  }
}

// Results exist once the poll has gone out.
export const pollHasSent = (status: PollStatus): boolean => {
  const phase = pollPhase(status)
  return phase === 'in_progress' || phase === 'done'
}

// Keeps asking while responses can still arrive or a run is in flight, and
// stops by itself the first time neither is true.
export const pollRefetchInterval = (
  status: PollStatus,
  analysis: PollAnalysisStatus | undefined,
): number | false =>
  status === 'in_progress' || analysis === 'running'
    ? POLL_RESULTS_REFRESH_MS
    : false

export const pollDetailQueryOptions = (outreachId: number) =>
  queryOptions({
    queryKey: ['poll-results', 'detail', outreachId] as const,
    queryFn: () =>
      clientRequest('GET /v1/outreach/serve/:id', {
        id: String(outreachId),
      }).then((res) => res.data),
    refetchInterval: (query) =>
      pollRefetchInterval(query.state.data?.status ?? null, undefined),
  })

export const pollResultsQueryKey = (outreachId: number) =>
  ['poll-results', 'results', outreachId] as const

export const pollResultsQueryOptions = (
  outreachId: number,
  status: PollStatus,
) =>
  queryOptions({
    queryKey: pollResultsQueryKey(outreachId),
    queryFn: () =>
      clientRequest('GET /v1/outreach/serve/:id/poll-results', {
        id: String(outreachId),
      }).then((res) => res.data),
    refetchInterval: (query) =>
      pollRefetchInterval(status, query.state.data?.analysis.status),
  })

export type ReplyScope =
  | { kind: 'all' }
  | { kind: 'theme'; themeId: string }
  | { kind: 'nonClustered' }

export const pollRepliesQueryPrefix = (outreachId: number) =>
  ['poll-results', 'replies', outreachId] as const

const scopeParams = (
  scope: ReplyScope,
): { themeId?: string; nonClustered?: boolean } => {
  if (scope.kind === 'theme') return { themeId: scope.themeId }
  if (scope.kind === 'nonClustered') return { nonClustered: true }
  return {}
}

// Offset-paged like the shared reply list: a first screenful, then the
// server's ceiling per page. The order is stable, so the running count is an
// exact offset.
export const pollRepliesQueryOptions = (
  outreachId: number,
  scope: ReplyScope,
  filter: SmsOutreachRepliesFilter,
) =>
  infiniteQueryOptions({
    queryKey: [...pollRepliesQueryPrefix(outreachId), scope, filter] as const,
    queryFn: async ({ pageParam }): Promise<SmsOutreachReplies> => {
      const { data } = await clientRequest(
        'GET /v1/outreach/serve/:id/replies',
        {
          id: String(outreachId),
          limit:
            pageParam === 0
              ? SMS_OUTREACH_REPLIES_DEFAULT_LIMIT
              : SMS_OUTREACH_REPLIES_MAX_LIMIT,
          offset: pageParam,
          filter,
          ...scopeParams(scope),
        },
      )
      return data
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.replies.length === 0) return undefined
      const loaded = allPages.reduce(
        (count, page) => count + page.replies.length,
        0,
      )
      return loaded < lastPage.total ? loaded : undefined
    },
    retry: false,
  })

type RepliesCache = InfiniteData<SmsOutreachReplies, number>

// The mark shows at once in every cached list the reply sits in, and is put
// back if the write fails. No refetch on success: one would drop a response
// out of the Unread list while it is still open.
export const useReplyFlagMutation = (outreachId: number) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      replyId,
      update,
    }: {
      replyId: string
      update: ReplyFlagUpdate
    }) =>
      clientRequest('PUT /v1/outreach/serve/:id/replies/:replyId/flags', {
        id: String(outreachId),
        replyId,
        ...update,
      }).then((res) => res.data),
    onMutate: async ({ replyId, update }) => {
      const queryKey = pollRepliesQueryPrefix(outreachId)
      await queryClient.cancelQueries({ queryKey })
      const snapshot = queryClient.getQueriesData<RepliesCache>({ queryKey })
      queryClient.setQueriesData<RepliesCache>({ queryKey }, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                replies: page.replies.map((reply) =>
                  reply.id === replyId ? { ...reply, ...update } : reply,
                ),
              })),
            }
          : data,
      )
      return { snapshot }
    },
    onError: (_error, _variables, context) => {
      context?.snapshot.forEach(([queryKey, data]) =>
        queryClient.setQueryData(queryKey, data),
      )
    },
  })
}
