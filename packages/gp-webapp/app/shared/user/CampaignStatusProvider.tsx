'use client'
import { createContext, useEffect, useMemo, useState } from 'react'
import { noop } from '@shared/utils/noop'
import { fetchCampaignStatus } from 'helpers/fetchCampaignStatus'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useUser } from '@shared/hooks/useUser'
import { useOrganization } from '@shared/organization-picker'
import { useTeamAccountsFlag } from '@shared/experiments/teamAccountsFlag'

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
  // trackExposure=false: a render-decision read for routing, not the
  // experiment's own treatment surface (mirrors every other nav/routing read
  // of this flag — DashboardMenu, the org picker).
  const { enabled: teamAccountsEnabled } = useTeamAccountsFlag(false)
  const activeOrg = useOrganization()
  // gp-api's UseCampaignGuard fails closed on a volunteer membership, so this
  // fetch 403s every time for a volunteer's active org (ENG-11072) —
  // fetchCampaignStatus swallows that into `{ status: false }` today, which
  // is what a volunteer effectively has, so skip the request outright.
  const isActiveOrgVolunteer =
    teamAccountsEnabled && activeOrg?.role === 'volunteer'

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
