'use client'
import { createContext, useEffect, useMemo, useState } from 'react'
import { noop } from '@shared/utils/noop'
import { fetchCampaignStatus } from 'helpers/fetchCampaignStatus'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useUser } from '@shared/hooks/useUser'
import { useOrganization } from '@shared/organization-picker'

interface CampaignStatus {
  status: boolean | string
  [key: string]: string | boolean | number | null | undefined
}

type CampaignStatusContextValue = [
  campaignStatus: CampaignStatus | null,
  setCampaignStatus: (status: CampaignStatus | null) => void,
]

export const CampaignStatusContext = createContext<CampaignStatusContextValue>([
  null,
  noop,
])

interface CampaignStatusProviderProps {
  children: React.ReactNode
}

export const CampaignStatusProvider = ({
  children,
}: CampaignStatusProviderProps): React.JSX.Element => {
  const [campaignStatus, setCampaignStatus] = useState<CampaignStatus | null>(
    null,
  )
  const [campaign] = useCampaign()
  const [user] = useUser()
  const activeOrg = useOrganization()
  // gp-api's UseCampaignGuard fails closed on a volunteer membership, so this
  // fetch 403s every time for a volunteer's active org (ENG-11072) —
  // fetchCampaignStatus swallows that into `{ status: false }` today, which
  // is what a volunteer effectively has, so skip the request outright.
  const isActiveOrgVolunteer = activeOrg?.role === 'volunteer'

  useEffect(() => {
    const getStatus = async () => {
      const status = await fetchCampaignStatus()
      setCampaignStatus(
        (status as { ok?: boolean }).ok === false
          ? null
          : (status as CampaignStatus),
      )
    }
    if (user && !isActiveOrgVolunteer) {
      getStatus()
    } else {
      // A campaign-org → volunteer-org switch re-runs this effect with the
      // fetch skipped; without clearing, the previous org's status (e.g.
      // 'candidate') would stick for the rest of the session.
      setCampaignStatus(null)
    }
  }, [campaign, user, isActiveOrgVolunteer])

  const contextValue = useMemo<CampaignStatusContextValue>(
    () => [campaignStatus, setCampaignStatus],
    [campaignStatus],
  )

  return (
    <CampaignStatusContext.Provider value={contextValue}>
      {children}
    </CampaignStatusContext.Provider>
  )
}
