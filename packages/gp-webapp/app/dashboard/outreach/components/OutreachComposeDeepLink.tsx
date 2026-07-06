'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import TaskFlow from 'app/dashboard/components/tasks/flows/TaskFlow'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import { MAX_SMS_CHAR_COUNT } from 'app/dashboard/components/tasks/flows/AddScriptStep/CreateSmSScriptScreen'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useTextOutreachGate } from 'app/dashboard/outreach/hooks/useTextOutreachGate'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { TcrCompliance } from 'helpers/types'

interface OutreachComposeDeepLinkProps {
  tcrCompliance?: TcrCompliance
}

export const OutreachComposeDeepLink = ({
  tcrCompliance,
}: OutreachComposeDeepLinkProps): React.JSX.Element => {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [campaign] = useCampaign()
  const { runTextGate, gateModals } = useTextOutreachGate(tcrCompliance)
  const [flowScript, setFlowScript] = useState<string | null>(null)
  const consumedRef = useRef(false)

  const isComposeText = searchParams?.get('compose') === 'text'

  useEffect(() => {
    if (consumedRef.current || !isComposeText || !campaign) return
    consumedRef.current = true
    const message = (searchParams?.get('message') || '').slice(
      0,
      MAX_SMS_CHAR_COUNT,
    )
    router.replace('/dashboard/outreach', { scroll: false })
    trackEvent(EVENTS.Outreach.ClickCreate, {
      type: OUTREACH_TYPES.text,
      source: 'deep_link',
    })
    if (runTextGate()) {
      setFlowScript(message)
    }
  }, [isComposeText, campaign, searchParams, router, runTextGate])

  return (
    <>
      {flowScript !== null && campaign && (
        <TaskFlow
          forceOpen
          type={OUTREACH_TYPES.text}
          campaign={campaign}
          initialScriptText={flowScript || undefined}
          onClose={() => setFlowScript(null)}
        />
      )}
      {gateModals}
    </>
  )
}
