'use client'

import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'

const STRATEGY_EXISTS_ROUTE = 'GET /v1/campaignStrategy/mine/exists' as const

// Gates the Campaign Plan menu item directly off the API instead of a field
// on the cached campaign object. Campaign-cache writes from unrelated flows
// (e.g. pro-upgrade steps storing a raw PUT response) kept wiping the
// computed hasCampaignStrategy field and hiding the tab mid-session; asking
// the server every time the menu mounts removes that dependency entirely.
// Returns false while loading or on error — the tab appears when the answer
// arrives, and a transient failure degrades to "hidden", never to a crash.
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
