import { useCallback, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type {
  CivicPanelComposition,
  CivicPanelReachChannel,
  CivicPanelReachGroup,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import {
  PhoneBankingFlow,
  SERVE_PHONE_BANKING_SURFACE,
} from 'app/dashboard/outreach/v2/phone-banking/PhoneBankingFlow'
import { SERVE_CITIZENS_PANEL_COPY as COPY } from '../citizensPanelCopy'
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

export const doorKnockingHref = (listId: number): string =>
  `/dashboard/door-knocking?${new URLSearchParams({
    create: '1',
    listId: String(listId),
  }).toString()}`

// Saves a group's door or call list, then opens the existing flow on it:
// door knocking's create flow by its page, phone banking over this one.
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
  const [callListId, setCallListId] = useState<number | null>(null)

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
          setCallListId(data.listId)
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
    [pending, router, errorSnackbar],
  )

  const flow =
    callListId !== null ? (
      <PhoneBankingFlow
        open
        onClose={() => setCallListId(null)}
        onSaved={() => setCallListId(null)}
        surface={SERVE_PHONE_BANKING_SURFACE}
        preselectedListId={callListId}
        source="deep_link"
      />
    ) : null

  return { reach, pending, flow }
}
