'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'

// The dashboard sidebar gates its Campaign Plan tab on
// campaign.hasCampaignStrategy, which flips true when gp-api upserts the
// campaignStrategy row — and that upsert is triggered by this page's own
// first strategic-landscape/community-events request. The campaign refetch
// that InvalidateCampaignOnMount fires at mount races that upsert (and
// reliably loses on the manual-office-entry path, which has no office-step
// pre-warm), leaving a stale `false` in the cache so the tab is missing
// after continuing to the dashboard. Re-sync the campaign once the row
// provably exists server-side.
export const useRefreshCampaignOnStrategyCreated = (
  strategyRowExists: boolean,
): void => {
  const queryClient = useQueryClient()
  const invalidated = useRef(false)

  useEffect(() => {
    if (!strategyRowExists || invalidated.current) return
    invalidated.current = true
    void queryClient.invalidateQueries({ queryKey: CAMPAIGN_QUERY_KEY })
  }, [strategyRowExists, queryClient])
}
