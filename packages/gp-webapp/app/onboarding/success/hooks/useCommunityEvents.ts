'use client'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import type {
  CommunityEventsData,
  CommunityEventsResponse,
} from 'gpApi/api-endpoints'

const COMMUNITY_EVENTS_ROUTE =
  'POST /v1/campaignStrategy/mine/community-events' as const

const COMMUNITY_EVENTS_QUERY_KEY = ['community-events', 'mine'] as const

// Background generation runs Gemini search + structured in series. Roughly
// 15-30s end-to-end on first call. Cache hits return immediately.
const POLL_INTERVAL_MS = 3000

const communityEventsQueryOptions = (enabled: boolean) =>
  queryOptions({
    queryKey: COMMUNITY_EVENTS_QUERY_KEY,
    queryFn: () =>
      clientRequest(COMMUNITY_EVENTS_ROUTE, {}).then((res) => res.data),
    // Story-on campaigns get their events from the campaign tracker (CAP), not
    // this endpoint — gate the poll off so they never trigger a legacy
    // community-events generation no one will see.
    enabled,
    refetchInterval: (query) =>
      query.state.data?.status === 'generating' ? POLL_INTERVAL_MS : false,
    // Within a mount, ready data stays fresh. Across mounts we ALWAYS
    // re-poll (refetchOnMount below): the endpoint doubles as the
    // race-change detector — gp-api compares the strategy row's race stamp
    // to the campaign's current race on every call and resets stale
    // content. Skipping the call on a plan-page visit would keep serving
    // the previous race's cached sections after an office change.
    staleTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    // 400 (missing raceId/electionDate) and 502 (Gemini down) don't benefit
    // from aggressive retry — surface to the UI's empty/error state.
    retry: 1,
  })

export type CommunityEventsQueryResult = {
  data: CommunityEventsData | undefined
  isGenerating: boolean
  isPending: boolean
  isError: boolean
}

export function useCommunityEvents(enabled = true): CommunityEventsQueryResult {
  const query = useQuery(communityEventsQueryOptions(enabled))
  const response: CommunityEventsResponse | undefined = query.data
  // When disabled the query never runs, so react-query keeps isPending true
  // forever. Report not-pending/not-generating so it never blocks planReady or
  // shows a perpetual events skeleton for the story-on cohort.
  if (!enabled) {
    return {
      data: undefined,
      isGenerating: false,
      isPending: false,
      isError: false,
    }
  }
  return {
    data: response?.status === 'ready' ? response.data : undefined,
    isGenerating: response?.status === 'generating',
    isPending: query.isPending,
    isError: query.isError,
  }
}

// Pre-warm hook: fire-and-forget POST that kicks off the background
// generation without waiting for the result. Called after the user
// submits their office in onboarding so the events are usually ready by
// the time they reach the success page. The endpoint is idempotent
// (server-side inFlight slot + JSON-column cache), so multiple calls are
// safe — only the first one triggers an LLM run.
export async function prewarmCommunityEvents(): Promise<void> {
  try {
    await clientRequest(COMMUNITY_EVENTS_ROUTE, {})
  } catch {
    // Swallow — pre-warm is best-effort. The success page will re-call
    // the endpoint and surface real errors via the polling hook.
  }
}
