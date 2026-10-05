import { createContext, useContext, useState, ReactNode } from 'react'

type OutreachType =
  | 'text'
  | 'doorKnocking'
  | 'nativeDoorKnocking'
  | 'phoneBanking'
  | 'nativePhoneBanking'
  | 'socialMedia'
  | 'robocall'
  | 'p2p'
type OutreachStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'paid'
  | 'in_progress'
  | 'completed'
  | 'pending_payment'
  | 'canceled'
  | 'failed'
  | 'draft'

export interface Outreach {
  id: number
  createdAt?: Date | string
  updatedAt?: Date | string
  campaignId?: number | null
  outreachType?: OutreachType
  projectId?: string | null
  name?: string | null
  status?: OutreachStatus | null
  error?: string | null
  audienceRequest?: string | null
  script?: string | null
  message?: string | null
  date?: Date | string | null
  imageUrl?: string | null
  voterFileFilterId?: number | null
  // The frozen route a nativeDoorKnocking envelope belongs to (unique on the
  // Prisma model). It has always ridden the list payload — `findByCampaignId`
  // selects the whole row — and is declared here because it is the only join
  // key between a walk's two archive flags; see `native/turfLifecycle.ts`.
  doorKnockingRouteId?: number | null
  phoneListId?: number | null
  identityId?: string | null
  didState?: string | null
  title?: string | null
  billableTextCount?: number | null
  textCount?: number | null
  archivedAt?: Date | string | null
  // For a door-knocking sibling: the id of the anchor Outreach whose
  // campaign it belongs to. Null on an anchor and on every non-door-knocking
  // row. Rides the row because the history table collapses siblings into
  // their anchor server-side — the collapsed row IS the anchor and carries
  // this null, but a deep-linked sibling arrives with the anchor id here.
  campaignOutreachId?: number | null
  // How many turfs the door-knocking campaign this row anchors currently
  // holds. Server-side rollup, present on door-knocking rows only; every
  // other channel is `1` (a campaign of one). Read by the history table's
  // "N turfs" badge and by the drawer's siblings section.
  turfCount?: number
}

type OutreachContextValue = [Outreach[], (outreaches: Outreach[]) => void]

export const outreachContext = createContext<OutreachContextValue>([
  [],
  () => [],
])

interface OutreachProviderProps {
  initValue?: Outreach[]
  children: ReactNode
}

export const OutreachProvider = ({
  initValue = [],
  children,
}: OutreachProviderProps): React.JSX.Element => {
  const [outreaches, setOutreaches] = useState<Outreach[]>(initValue)

  return (
    <outreachContext.Provider value={[outreaches, setOutreaches]}>
      {children}
    </outreachContext.Provider>
  )
}

export const useOutreach = (): OutreachContextValue =>
  useContext(outreachContext)
