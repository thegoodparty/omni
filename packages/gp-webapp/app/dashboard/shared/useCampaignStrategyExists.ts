'use client'

import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'

const STRATEGY_EXISTS_ROUTE = 'GET /v1/campaignStrategy/mine/exists' as const

// Gates the Campaign Plan menu item directly off the API instead of a field
// on the cached campaign object. Campaign-cache writes from unrelated flows
// (e.g. pro-upgrade steps storing a raw PUT response) kept wiping the
// computed hasCampaignStrategy field and hiding the tab mid-session; asking
// the server every time the menu mounts removes that dependency entirely.
// Returns false while the first answer is loading or if it errors; once an
// answer exists, a failed refetch keeps the last known value (React Query
// retains it), so a transient network blip never yanks a visible tab.
export const useCampaignStrategyExists = (): boolean => {
  const query = useQuery({
    queryKey: ['campaign-strategy-exists'],
    queryFn: () =>
      clientRequest(STRATEGY_EXISTS_ROUTE, {}).then((res) => res.data),
    staleTime: 0,
    refetchOnMount: 'always',
  })
  return query.data?.exists === true
}
