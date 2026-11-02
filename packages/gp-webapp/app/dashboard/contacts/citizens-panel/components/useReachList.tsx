import { useCallback, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type {
  CivicPanelComposition,
  CivicPanelReachChannel,
  CivicPanelReachGroup,
} from '@goodparty_org/contracts'
import {
  BUILD_CITIZENS_PANEL_PURPOSE,
  PHONE_BANKING_NAME_MAX_LENGTH,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import {
  PhoneBankingFlow,
  SERVE_PHONE_BANKING_SURFACE,
} from 'app/dashboard/outreach/v2/phone-banking/PhoneBankingFlow'
import { SERVE_CITIZENS_PANEL_COPY as COPY } from '../citizensPanelCopy'
import { useCivicPanelReachScript } from '../civicPanelReachScript'
import type { ShortGroup } from './panelCharts'

// A short group as the reach-lists route names it. "Some parts of your
// district" names nobody, so it has no list.
export const reachGroupOf = (
  row: ShortGroup,
  placeKind: CivicPanelComposition['placeKind'],
): CivicPanelReachGroup | null => {
  if (row.kind === 'place') return { kind: placeKind, key: row.key }
  return row.group === 'unreachedAreas'
    ? null
    : { kind: 'group', group: row.group }
}

const statusOf = (error: object | null): number | undefined =>
  error && 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined

// The invite purpose rides along, so door knocking skips the goal and the
// list and opens on the invite's talking points.
export const doorKnockingHref = (listId: number): string =>
  `/dashboard/door-knocking?${new URLSearchParams({
    create: '1',
    listId: String(listId),
    purpose: BUILD_CITIZENS_PANEL_PURPOSE,
  }).toString()}`

interface CallList {
  listId: number
  name: string
  invite: { script: string }
}

// Saves a group's door or call list, then opens the existing flow on it as
// a civic panel invite: door knocking's create flow by its page, phone
// banking over this one, each on the invite's script.
export const useReachList = (): {
  reach: (
    group: CivicPanelReachGroup,
    channel: CivicPanelReachChannel,
    name: string,
  ) => Promise<void>
  pending: string | null
  flow: ReactNode
} => {
  const router = useRouter()
  const { errorSnackbar } = useSnackbar()
  const [pending, setPending] = useState<string | null>(null)
  const [call, setCall] = useState<CallList | null>(null)
  const callScript = useCivicPanelReachScript('phone')

  const reach = useCallback(
    async (
      group: CivicPanelReachGroup,
      channel: CivicPanelReachChannel,
      name: string,
    ) => {
      const key = `${JSON.stringify(group)}:${channel}`
      if (pending) return
      setPending(key)
      try {
        const { data } = await clientRequest(
          'POST /v1/contacts/civic-panel/reach-lists',
          { group, channel, name },
        )
        if (channel === 'door') {
          router.push(doorKnockingHref(data.listId))
        } else {
          setCall({
            listId: data.listId,
            name: name.slice(0, PHONE_BANKING_NAME_MAX_LENGTH),
            invite: { script: callScript },
          })
        }
      } catch (error) {
        errorSnackbar(
          statusOf(error instanceof Object ? error : null) === 422
            ? COPY.reachNobody
            : COPY.reachError,
        )
      } finally {
        setPending(null)
      }
    },
    [pending, router, errorSnackbar, callScript],
  )

  const flow =
    call !== null ? (
      <PhoneBankingFlow
        open
        onClose={() => setCall(null)}
        surface={SERVE_PHONE_BANKING_SURFACE}
        preselectedListId={call.listId}
        initialName={call.name}
        civicPanelInvite={call.invite}
        source="deep_link"
      />
    ) : null

  return { reach, pending, flow }
}
