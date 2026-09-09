'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useOrganization } from '@shared/organization-picker'
import DashboardLayout from '../shared/DashboardLayout'
import { NAV_LABELS } from '../shared/navLabels'
import CampaignManagerHome from '../campaign-manager/CampaignManagerHome'
import CampaignManagerChatHome from '../campaign-manager/CampaignManagerChatHome'
import { WebsiteSunsetModalController } from '../shared/WebsiteSunsetModalController'
import { useCampaignManagerChatHomeFlag } from '@shared/experiments/campaignManagerChatHomeFlag'
import type { TcrCompliance } from 'helpers/types'

interface DashboardContentProps {
  pathname: string
  tcrCompliance: TcrCompliance | null
  sunsetEligible: boolean
}

export default function DashboardContent({
  pathname,
  tcrCompliance,
  sunsetEligible,
}: DashboardContentProps): React.JSX.Element {
  const router = useRouter()
  const organization = useOrganization()
  // `/dashboard` is Win-only, enforced by a server redirect at page load. But
  // the org picker switches client-side (it writes a cookie and invalidates
  // queries, it does not navigate), so switching to a Serve org here leaves
  // this page mounted — and the conversational home would go on answering as
  // the Campaign Manager under an elected-office org. Mirror the redirect
  // client-side off the same signal the chat dock uses
  // (DashboardCampaignManagerChat).
  const isServeOrg = !!organization?.electedOfficeId
  useEffect(() => {
    if (isServeOrg) router.replace('/dashboard/chief-of-staff')
  }, [isServeOrg, router])

  const { ready, enabled } = useCampaignManagerChatHomeFlag()
  // The card home is the fallback for every state that isn't a resolved "on":
  // loading, off, an anonymous read, a gp-api failure. Deliberately not gated
  // the other way (render nothing until `ready`) — `ready` stays false forever
  // when the provider never resolves, which would blank the dashboard rather
  // than degrade to the home that works. A flagged candidate can see one frame
  // of the card home on a cold resolve; that is the cheaper failure.
  const chatHome = ready && enabled

  return (
    <DashboardLayout
      pathname={pathname}
      showAlert={false}
      wrapperClassName="!p-0"
      navHeader={{ icon: 'dashboard', label: NAV_LABELS.campaignManager }}
      // The conversational home IS the chat, so the footer dock would put a
      // second one on screen — and its fixed bar would sit over this page's own
      // composer.
      hideChatDock={chatHome}
    >
      <WebsiteSunsetModalController eligible={sunsetEligible} />
      {/* Nothing while the redirect above is in flight: the Win home would
          otherwise talk to campaign_assistant under a Serve org. */}
      {isServeOrg ? null : chatHome ? (
        <CampaignManagerChatHome tcrCompliance={tcrCompliance} />
      ) : (
        <CampaignManagerHome tcrCompliance={tcrCompliance} />
      )}
    </DashboardLayout>
  )
}
