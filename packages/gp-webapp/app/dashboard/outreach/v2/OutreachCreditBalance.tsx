import { formatOutreachCost } from '../util/outreachPricing'
import { useOutreachCredit } from '../util/outreachCredit'

// Plain text in the hub's "Send outreach" header, not a card of its own.
export const OutreachCreditBalance = () => {
  const { active, balanceCents } = useOutreachCredit()
  if (!active) return null
  return (
    <p
      className="text-sm text-muted-foreground"
      data-testid="outreach-credit-balance"
    >
      Outreach credit{' '}
      <span className="font-semibold text-foreground">
        {formatOutreachCost(balanceCents)}
      </span>
    </p>
  )
}
