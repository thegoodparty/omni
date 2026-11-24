'use client'
import { createContext, useMemo, useRef } from 'react'
import { Campaign } from 'helpers/types'
import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import { FetchError } from 'ofetch'
import { useOrganization } from '@shared/organization-picker'

type CampaignContextValue = [campaign: Campaign | null]

export const CampaignContext = createContext<CampaignContextValue>([null])

interface CampaignProviderProps {
  children: React.ReactNode
  campaign: Campaign | null
}

export const CAMPAIGN_QUERY_KEY = ['campaign']

// Shared so consumers can observe the same campaign query (deduped by key)
// rather than redefining the fetch. A 404 means "no campaign yet" (null);
// other errors propagate so callers can show a recoverable error state.
export const fetchCampaign = async (): Promise<Campaign | null> => {
  try {
    const res = await clientRequest('GET /v1/campaigns/mine', {})
    return res.data
  } catch (e) {
    if (e instanceof FetchError && e.status === 404) return null
    throw e
  }
}

export const CampaignProvider = ({
  children,
  campaign: initCampaign,
}: CampaignProviderProps): React.JSX.Element => {
  const activeOrg = useOrganization()
  // gp-api's UseCampaignGuard fails closed on a volunteer membership (403,
  // not 404), so fetchCampaign's 404-only swallow lets it throw and React
  // Query retries into repeated console 403s (ENG-11072). A volunteer never
  // has a campaign, so skip the request outright.
  const isActiveOrgVolunteer = activeOrg?.role === 'volunteer'
  // An elected-office (Serve) org has its own slug, never a campaign's, so
  // /campaigns/mine always 404s for it (ENG-11308).
  const hasNoCampaign =
    isActiveOrgVolunteer || Boolean(activeOrg?.electedOfficeId)

  // The server's campaign is the one for the org the page was rendered for, as
  // it was when the page loaded. Once the org has changed it is wrong for any
  // org, including the first one if the user comes back to it, because the
  // cache has moved on since: so the seed is dropped for good at the first
  // change.
  const seededFor = useRef(activeOrg?.slug)
  const seedDropped = useRef(false)
  if (activeOrg?.slug !== seededFor.current) seedDropped.current = true
  const query = useQuery({
    queryKey: CAMPAIGN_QUERY_KEY,
    queryFn: fetchCampaign,
    initialData: seedDropped.current ? undefined : (initCampaign ?? undefined),
    enabled: !hasNoCampaign,
  })

  // enabled:false blocks refetches but not the cache: after an owner-org →
  // volunteer/Serve-org switch the org list re-read leaves this query disabled
  // with the prior query.data still in the cache, so short-circuit it for a
  // volunteer.
  const campaign = hasNoCampaign ? null : (query.data ?? null)
  const contextValue = useMemo<CampaignContextValue>(
    () => [campaign],
    [campaign],
  )

  return (
    <CampaignContext.Provider value={contextValue}>
      {children}
    </CampaignContext.Provider>
  )
}
