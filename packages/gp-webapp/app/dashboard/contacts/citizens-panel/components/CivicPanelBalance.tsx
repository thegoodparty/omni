import {
  CIVIC_PANEL_BALANCE_STATUS_LABELS,
  civicPanelFreshnessText,
  PANEL_MIN_MEMBERS_FOR_BALANCE,
  UNDERREPRESENTED_GROUP_NAMES,
  type CivicPanelBalance,
  type CivicPanelBalanceStatus as BalanceStatus,
  type CivicPanelCompositionGroup,
} from '@goodparty_org/contracts'
import { SERVE_CITIZENS_PANEL_COPY as COPY } from '../citizensPanelCopy'
import { CivicPanelBloom } from './CivicPanelBloom'

// The dot beside a status, so the label is never read by colour alone.
const PANEL_STATUS_DOT: Record<BalanceStatus, string> = {
  tooFewMembers: 'bg-muted-foreground',
  missingGroups: 'bg-warning',
  everyGroup: 'bg-primary',
}

const balanceLine = (balance: CivicPanelBalance): string | null => {
  if (balance.status === 'tooFewMembers') {
    return COPY.balanceTooFew(PANEL_MIN_MEMBERS_FOR_BALANCE)
  }
  return balance.inviteMore
    ? COPY.inviteMore(UNDERREPRESENTED_GROUP_NAMES[balance.inviteMore])
    : null
}

// Past the goal the status also says how many groups have no recent voices.
const statusLabel = (balance: CivicPanelBalance): string => {
  const label = CIVIC_PANEL_BALANCE_STATUS_LABELS[balance.status]
  const fresh = balance.groupsNeedingFresh
  if (fresh === undefined) return label
  if (fresh === 0 && balance.status === 'everyGroup') {
    return civicPanelFreshnessText(0)
  }
  return `${label} · ${civicPanelFreshnessText(fresh)}`
}

// The panel's own status, then the one group to invite next while any is
// missing. Shared by the panel page and the Chief of Staff's next step card.
export const CivicPanelBalanceStatus = ({
  balance,
}: {
  balance: CivicPanelBalance
}) => {
  const line = balanceLine(balance)
  return (
    <div className="flex flex-col gap-0.5" data-testid="civic-panel-balance">
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={`size-2 shrink-0 rounded-full ${PANEL_STATUS_DOT[balance.status]}`}
        />
        <span className="text-sm font-semibold text-foreground">
          {statusLabel(balance)}
        </span>
      </span>
      {line ? <p className="text-sm text-muted-foreground">{line}</p> : null}
    </div>
  )
}

// The status, then each group as a petal once the panel can be compared.
export const CivicPanelBalanceSection = ({
  balance,
  groups,
}: {
  balance: CivicPanelBalance
  groups: CivicPanelCompositionGroup[]
}) => (
  <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-5">
    <h2 className="text-base font-semibold text-foreground">
      {COPY.balanceTitle}
    </h2>
    <CivicPanelBalanceStatus balance={balance} />
    {balance.status !== 'tooFewMembers' && groups.length > 0 ? (
      <CivicPanelBloom
        groups={groups}
        showNext={balanceLine(balance) === null}
      />
    ) : null}
  </section>
)
