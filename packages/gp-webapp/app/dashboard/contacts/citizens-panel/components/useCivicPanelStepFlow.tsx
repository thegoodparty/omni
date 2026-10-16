import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  SERVE_PHONE_BANKING_PURPOSE_VALUES,
  SERVE_SMS_PURPOSE_VALUES,
  type CivicPanelBuildStep,
  type PrepareCivicPanelBuildStepResponse,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useServeSmsFlag } from '@shared/experiments/serveSmsFlag'
import {
  PhoneBankingFlow,
  SERVE_PHONE_BANKING_SURFACE,
} from 'app/dashboard/outreach/v2/phone-banking/PhoneBankingFlow'
import {
  SERVE_SMS_SURFACE,
  SmsFlow,
} from 'app/dashboard/outreach/v2/sms/SmsFlow'
import { walkableAreaParam } from 'app/dashboard/door-knocking/native/walkableAreaParam'
import { SERVE_CITIZENS_PANEL_COPY as COPY } from '../citizensPanelCopy'

type Opened =
  | {
      channel: 'text'
      listId: number
      purpose: (typeof SERVE_SMS_PURPOSE_VALUES)[number]
    }
  | {
      channel: 'phone_banking'
      listId: number
      purpose: (typeof SERVE_PHONE_BANKING_PURPOSE_VALUES)[number]
    }

// Where a call list or a walk already underway is worked.
export const keepGoingHref = (step: CivicPanelBuildStep): string | null => {
  if (step.status !== 'in_progress') return null
  if (step.channel === 'phone_banking' && step.phoneBankingListId !== null) {
    return `/dashboard/outreach/phone-banking/${step.phoneBankingListId}`
  }
  if (step.channel === 'door_knocking' && step.doorKnockingTurfId !== null) {
    return `/dashboard/door-knocking?walkTurfId=${step.doorKnockingTurfId}`
  }
  return null
}

// The door knocking create flow on the step's list and purpose, with the
// walkable area it drew as the turf's boundary.
const doorFlowHref = (data: PrepareCivicPanelBuildStepResponse): string => {
  const params = new URLSearchParams({
    create: '1',
    listId: String(data.voterFileFilterId),
    purpose: data.purpose,
  })
  const area = data.area ? walkableAreaParam(data.area) : null
  if (area) params.set('area', area)
  return `/dashboard/door-knocking?${params.toString()}`
}

/**
 * Opens a plan step in the standard flow for its channel, on the list it
 * drew, at the message with its civic panel invite drafting: texts and
 * calls in place over the page (render `flows`), doors on the door knocking
 * page with the walkable area as the boundary. The panel page and the Chief
 * of Staff chat's next step card both start a step through this.
 *
 * `open` resolves `navigating` when it left for the door knocking page and
 * `opened` when a flow is up; it throws when the step could not be prepared.
 * `onChange` runs when a flow closes or sends, so the caller reads the plan
 * again.
 */
export type CivicPanelStepSurface = 'panel_page' | 'chief_of_staff_chat'

export const useCivicPanelStepFlow = ({
  onChange,
  surface,
}: {
  onChange: () => Promise<void>
  surface: CivicPanelStepSurface
}) => {
  const router = useRouter()
  const sms = useServeSmsFlag(false)
  const [opened, setOpened] = useState<Opened | null>(null)

  const open = async (
    step: CivicPanelBuildStep,
  ): Promise<'navigating' | 'opened'> => {
    const { data } = await clientRequest(
      'POST /v1/contacts/civic-panel/plan/steps/:id/prepare',
      { id: step.id },
    )
    trackEvent(EVENTS.CivicPanel.StepOpened, {
      stepId: step.id,
      channel: data.channel,
      wave: step.wave,
      surface,
    })
    if (data.channel === 'door_knocking') {
      router.push(doorFlowHref(data))
      return 'navigating'
    }
    const smsPurpose = SERVE_SMS_PURPOSE_VALUES.find(
      (purpose) => purpose === data.purpose,
    )
    const callPurpose = SERVE_PHONE_BANKING_PURPOSE_VALUES.find(
      (purpose) => purpose === data.purpose,
    )
    if (data.channel === 'text' && smsPurpose) {
      setOpened({
        channel: 'text',
        listId: data.voterFileFilterId,
        purpose: smsPurpose,
      })
      return 'opened'
    }
    if (data.channel === 'phone_banking' && callPurpose) {
      setOpened({
        channel: 'phone_banking',
        listId: data.voterFileFilterId,
        purpose: callPurpose,
      })
      return 'opened'
    }
    throw new Error(`No flow for ${data.channel} on ${data.purpose}`)
  }

  const close = () => {
    setOpened(null)
    void onChange()
  }

  const flows = (
    <>
      {opened?.channel === 'text' && sms.ready && sms.enabled ? (
        <SmsFlow
          open
          onClose={close}
          onScheduled={onChange}
          surface={SERVE_SMS_SURFACE}
          initialPurpose={opened.purpose}
          preselectedListId={opened.listId}
          audienceSettled
          source="deep_link"
        />
      ) : null}
      {opened?.channel === 'phone_banking' ? (
        <PhoneBankingFlow
          open
          onClose={close}
          onSaved={() => void onChange()}
          surface={SERVE_PHONE_BANKING_SURFACE}
          preselectedListId={opened.listId}
          initialPurpose={opened.purpose}
          initialName={COPY.callListName}
          source="deep_link"
        />
      ) : null}
    </>
  )

  // With texting off a text step offers no action, only this note.
  const textingOff = sms.ready && !sms.enabled

  return { open, flows, textingOff }
}
