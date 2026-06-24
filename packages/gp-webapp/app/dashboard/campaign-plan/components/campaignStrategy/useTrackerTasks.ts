'use client'
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'

const TRACKER_TASKS_ROUTE = 'GET /v1/campaigns/tracker-tasks' as const
const TRACKER_TASKS_QUERY_KEY = ['campaign-tracker-tasks', 'mine'] as const

// Stable reference so consumers can memoize on `tasks` without re-running on
// every render while the query is pending.
const EMPTY_TASKS: CampaignTrackerTask[] = []

// Only the static launch/pre-launch rows exist right after bootstrap; the
// dynamic tasks + events land minutes later when the CAP run completes. Treat
// "rows present but none dynamic yet" as still-generating.
export const isTrackerGenerating = (tasks: CampaignTrackerTask[]): boolean =>
  tasks.length > 0 && !tasks.some((t) => !t.isDefaultTask)

const POLL_INTERVAL_MS = 20 * 1000

const trackerTasksQueryOptions = () =>
  queryOptions({
    queryKey: TRACKER_TASKS_QUERY_KEY,
    queryFn: () => clientRequest(TRACKER_TASKS_ROUTE, {}).then((r) => r.data),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    // Poll while the dynamic tasks/events are still generating so they appear
    // without a manual refresh; stop once any dynamic row lands.
    refetchInterval: (query) =>
      query.state.data && isTrackerGenerating(query.state.data)
        ? POLL_INTERVAL_MS
        : false,
  })

export type TrackerTasksResult = {
  tasks: CampaignTrackerTask[]
  isPending: boolean
  isError: boolean
  // Static rows are showing but the dynamic tasks + events are still generating.
  isGeneratingDynamic: boolean
}

export function useTrackerTasks(): TrackerTasksResult {
  const query = useQuery(trackerTasksQueryOptions())
  const tasks = query.data ?? EMPTY_TASKS
  return {
    tasks,
    isPending: query.isPending,
    isError: query.isError,
    isGeneratingDynamic: isTrackerGenerating(tasks),
  }
}

// Optimistic-free toggle: complete -> PUT, uncomplete -> DELETE, then refetch.
export function useToggleTrackerTaskComplete() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      completed
        ? clientRequest('PUT /v1/campaigns/tracker-tasks/complete/:id', { id })
        : clientRequest('DELETE /v1/campaigns/tracker-tasks/complete/:id', {
            id,
          }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: TRACKER_TASKS_QUERY_KEY }),
  })
}
