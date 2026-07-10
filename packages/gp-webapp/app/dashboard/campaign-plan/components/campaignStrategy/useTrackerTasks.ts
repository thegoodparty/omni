'use client'
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'

const TRACKER_TASKS_ROUTE = 'GET /v1/campaigns/tracker-tasks' as const
const TRACKER_TASKS_QUERY_KEY = ['campaign-tracker-tasks', 'mine'] as const

// Stable reference so consumers can memoize on `tasks` without re-running on
// every render while the query is pending.
const EMPTY_TASKS: CampaignTrackerTask[] = []

// Only the static launch/pre-launch rows exist right after bootstrap; the
// dynamic tasks + events land minutes later when the CAP run completes. Treat
// "rows present but none dynamic yet" as still-generating. This drives the
// "personalizing…" banner, so it stays narrow: it must not fire before any
// row exists (that is the "setting up" state, handled by isTrackerSettling).
export const isTrackerGenerating = (tasks: CampaignTrackerTask[]): boolean =>
  tasks.length > 0 && !tasks.some((t) => !t.isDefaultTask)

// The tracker is still filling in while it has no rows yet (bootstrap + static
// materialization pending) OR only static rows so far (dynamic generating). In
// both states we poll fast so freshly materialized tasks surface on their own,
// without a manual page refresh.
export const isTrackerSettling = (tasks: CampaignTrackerTask[]): boolean =>
  tasks.length === 0 || isTrackerGenerating(tasks)

const POLL_INTERVAL_MS = 20 * 1000
// Once dynamic tasks land, keep a slow background poll. Weekly regen appends a
// new generation (rows are never deleted, so isTrackerSettling can't detect
// it), so without this a page left open across the weekly cron would show last
// week's tasks until the next mount/focus.
const BACKGROUND_POLL_MS = 5 * 60 * 1000
// Fast-poll for ~15 min of wall-clock while the tracker is settling, then back
// off. Wall-clock rather than a fetch count: dataUpdateCount increments on the
// mount + focus refetches enabled below too, so a count budget would be burned
// by ordinary tab-switching during onboarding before any interval poll fires.
// This caps the cost when tasks never land (dispatch no-ops, or the tracker
// never bootstraps because the campaign story was never completed).
const FAST_POLL_DURATION_MS = 15 * 60 * 1000
// Module scope: trackerTasksQueryOptions is re-invoked on every render, so
// closure state would reset each time. Reset to null when settling ends.
let fastPollStartedAt: number | null = null

const trackerTasksQueryOptions = () =>
  queryOptions({
    queryKey: TRACKER_TASKS_QUERY_KEY,
    queryFn: () => clientRequest(TRACKER_TASKS_ROUTE, {}).then((r) => r.data),
    staleTime: 60 * 1000,
    // Entering the tab (a mount) and refocusing it always refetch, so the
    // static rows that materialized after the first "setting up" fetch show on
    // navigation instead of serving a stale cached empty result until refresh.
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    // Keep polling while backgrounded so tasks that land while the candidate is
    // away (static, then dynamic minutes later) are picked up when they return.
    refetchIntervalInBackground: true,
    // Poll fast while the tracker is still settling (no rows yet, or static-only
    // with dynamic still generating) so tasks appear without a manual refresh;
    // once dynamic lands (or after the fast-poll window) drop to a slow
    // background poll so a later weekly regen still gets picked up. `undefined`
    // data (before the first fetch resolves) counts as settling, so the fast
    // interval is live from mount rather than falling back to the slow one.
    refetchInterval: (query) => {
      const data = query.state.data
      if (data !== undefined && !isTrackerSettling(data)) {
        fastPollStartedAt = null
        return BACKGROUND_POLL_MS
      }
      if (fastPollStartedAt === null) fastPollStartedAt = Date.now()
      return Date.now() - fastPollStartedAt < FAST_POLL_DURATION_MS
        ? POLL_INTERVAL_MS
        : BACKGROUND_POLL_MS
    },
  })

// flowTypes whose completion records a voter-contact count (each a valid
// CampaignUpdateHistoryType the complete endpoint accepts), matching the legacy
// task flow: community events + the outreach channels. Everything else (e.g.
// awareness, setup) completes with no count prompt.
const VOTER_CONTACT_FLOW_TYPES = new Set([
  'events',
  'doorKnocking',
  'phoneBanking',
  'text',
  'robocall',
  'socialMedia',
])

export const isVoterContactFlowType = (flowType: string | null): boolean =>
  flowType !== null && VOTER_CONTACT_FLOW_TYPES.has(flowType)

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
// Completing an outreach/events task can carry a voter-contact count (type +
// quantity); the API records it to update history + reportedVoterGoals.
export function useToggleTrackerTaskComplete() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      completed,
      type,
      quantity,
    }: {
      id: string
      completed: boolean
      type?: string
      quantity?: number
    }) =>
      completed
        ? clientRequest(
            'PUT /v1/campaigns/tracker-tasks/complete/:id',
            type && quantity ? { id, type, quantity } : { id },
          )
        : clientRequest('DELETE /v1/campaigns/tracker-tasks/complete/:id', {
            id,
          }),
    onSuccess: (_data, { completed, type, quantity }) => {
      queryClient.invalidateQueries({ queryKey: TRACKER_TASKS_QUERY_KEY })
      // A recorded voter count lands on campaign.data.reportedVoterGoals (which
      // the progress bar reads), and uncompleting reverses whatever count the
      // task recorded. Either way the campaign changed, so refetch it. On
      // uncomplete we can't tell here whether a count was recorded, so always
      // refetch then.
      if ((type && quantity) || !completed) {
        queryClient.invalidateQueries({ queryKey: CAMPAIGN_QUERY_KEY })
      }
    },
  })
}
