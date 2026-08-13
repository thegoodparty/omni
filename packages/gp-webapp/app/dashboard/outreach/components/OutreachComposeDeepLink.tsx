'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import TaskFlow from 'app/dashboard/components/tasks/flows/TaskFlow'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import type { OutreachType } from 'gpApi/types/outreach.types'
import { MAX_SMS_CHAR_COUNT } from 'app/dashboard/components/tasks/flows/AddScriptStep/CreateSmSScriptScreen'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useTextOutreachGate } from 'app/dashboard/outreach/hooks/useTextOutreachGate'
import { ProUpgradeModal, VARIANTS } from 'app/dashboard/shared/ProUpgradeModal'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { parsePositiveListId } from 'app/dashboard/outreach/util/parsePositiveListId.util'
import type { TcrCompliance } from 'helpers/types'

interface OutreachComposeDeepLinkProps {
  tcrCompliance?: TcrCompliance
}

// Deep-linkable compose types. The Campaign Tracker links its text/robocall
// tasks here so the flow opens with the task's due date attached (the due date
// rides the outreach record into the Slack notification).
const COMPOSE_TYPES: Record<string, OutreachType> = {
  text: OUTREACH_TYPES.text,
  robocall: OUTREACH_TYPES.robocall,
}

const DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface OpenFlow {
  type: OutreachType
  script?: string
  due?: string
  listId?: number
}

export const OutreachComposeDeepLink = ({
  tcrCompliance,
}: OutreachComposeDeepLinkProps): React.JSX.Element => {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [campaign] = useCampaign()
  const { runTextGate, gateModals } = useTextOutreachGate(tcrCompliance)
  const [flow, setFlow] = useState<OpenFlow | null>(null)
  const [showProUpgradeModal, setShowProUpgradeModal] = useState(false)
  const consumedRef = useRef(false)
  const listIdConsumedRef = useRef(false)

  const composeType = COMPOSE_TYPES[searchParams?.get('compose') ?? '']
  const listIdParam = searchParams?.get('listId')
  // ENG-10762 (delegate follow-up): when compose and listId arrive together,
  // this component opens its own TaskFlow directly (never routes through
  // OutreachCreateCards/OutreachPage), so it must parse and carry the
  // preselected list itself rather than relying on the server-threaded prop.
  const preselectedListId = parsePositiveListId(listIdParam)

  // ENG-10762: the CRM "Send outreach" link carries ?listId=<id> so the
  // server (page.tsx) can read it and thread preselectedListId down to the
  // audience step. Once consumed server-side there's nothing left for the
  // param to do client-side, so strip it from the address bar the same way
  // `compose` is stripped. When `compose` is also present, its own
  // router.replace already clears the whole query string (including
  // listId) — skip here so the two effects don't race on the same replace.
  useEffect(() => {
    // Re-arm when the param goes absent (post-strip), same as consumedRef
    // below, so a second ?listId= navigation while mounted still strips.
    if (!listIdParam) {
      listIdConsumedRef.current = false
      return
    }
    if (composeType || listIdConsumedRef.current) return
    listIdConsumedRef.current = true
    router.replace('/dashboard/outreach', { scroll: false })
  }, [listIdParam, composeType, router])

  useEffect(() => {
    // Once router.replace strips the params, composeType goes falsy: re-arm
    // the guard so a later deep link (from a tracker task clicked while this
    // page stays mounted — same route, new params) opens a fresh flow. The
    // ref only guards the async window between replace() and the params
    // actually updating.
    if (!composeType) {
      consumedRef.current = false
      return
    }
    if (consumedRef.current || !campaign) return
    consumedRef.current = true
    const message = (searchParams?.get('message') || '').slice(
      0,
      MAX_SMS_CHAR_COUNT,
    )
    const dueParam = searchParams?.get('due') || ''
    const due = DUE_DATE_RE.test(dueParam) ? dueParam : undefined
    router.replace('/dashboard/outreach', { scroll: false })
    trackEvent(EVENTS.Outreach.ClickCreate, {
      type: composeType,
      source: 'deep_link',
    })
    if (composeType === OUTREACH_TYPES.text) {
      if (runTextGate()) {
        setFlow({
          type: composeType,
          script: message,
          due,
          listId: preselectedListId,
        })
      }
      return
    }
    // Robocall (and any future non-text compose type) is Pro-gated the same
    // way the outreach create cards gate it.
    if (!campaign.isPro) {
      trackEvent(EVENTS.Outreach.P2PCompliance.ComplianceStarted, {
        source: 'deep_link',
      })
      setShowProUpgradeModal(true)
      return
    }
    setFlow({ type: composeType, due, listId: preselectedListId })
  }, [
    composeType,
    campaign,
    searchParams,
    router,
    runTextGate,
    preselectedListId,
  ])

  return (
    <>
      {flow && campaign && (
        <TaskFlow
          forceOpen
          type={flow.type}
          campaign={campaign}
          initialScriptText={flow.script || undefined}
          campaignPlanDueDate={flow.due}
          preselectedListId={flow.listId}
          onClose={() => setFlow(null)}
        />
      )}
      <ProUpgradeModal
        {...{
          variant: VARIANTS.Second_NonViable,
          open: showProUpgradeModal,
          onClose: () => setShowProUpgradeModal(false),
        }}
      />
      {gateModals}
    </>
  )
}
