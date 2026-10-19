import {
  PANEL_MIN_MEMBERS_FOR_BALANCE,
  READ_REPRESENTATIVENESS_LABELS,
  UNDERREPRESENTED_GROUP_NAMES,
  type CivicPanelBalance,
} from '@goodparty_org/contracts'
import { READ_STATUS_DOT } from 'app/dashboard/priorities/[priorityId]/readStatusCopy'
import { SERVE_CITIZENS_PANEL_COPY as COPY } from '../citizensPanelCopy'

const balanceLine = (balance: CivicPanelBalance): string | null => {
  if (balance.status === 'tooEarly') {
    return COPY.balanceTooEarly(PANEL_MIN_MEMBERS_FOR_BALANCE)
  }
  return balance.inviteMore
    ? COPY.inviteMore(UNDERREPRESENTED_GROUP_NAMES[balance.inviteMore])
    : null
}

// The status in the priority read's words, then the one group to invite
// next. Shared by the panel page and the Chief of Staff's next step card.
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
          className={`size-2 shrink-0 rounded-full ${READ_STATUS_DOT[balance.status]}`}
        />
        <span className="text-sm font-semibold text-foreground">
          {READ_REPRESENTATIVENESS_LABELS[balance.status]}
        </span>
      </span>
      {line ? <p className="text-sm text-muted-foreground">{line}</p> : null}
    </div>
  )
}

export const CivicPanelBalanceSection = ({
  balance,
}: {
  balance: CivicPanelBalance
}) => (
  <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-5">
    <h2 className="text-base font-semibold text-foreground">
      {COPY.balanceTitle}
    </h2>
    <CivicPanelBalanceStatus balance={balance} />
  </section>
)
