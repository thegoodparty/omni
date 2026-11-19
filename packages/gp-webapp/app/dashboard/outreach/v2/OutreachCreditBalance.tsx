import { PRICE_PER_TEXT } from '@goodparty_org/contracts'
import { Card } from '@styleguide'
import { formatOutreachCost } from '../util/outreachPricing'
import { useOutreachCredit } from '../util/outreachCredit'
import { centsLabel } from './channelPrices'

export const OutreachCreditBalance = () => {
  const { active, balanceCents } = useOutreachCredit()
  if (!active) return null
  const texts = Math.floor(
    (balanceCents * 10) / Math.round(PRICE_PER_TEXT * 1000),
  )
  return (
    <Card className="mb-6 gap-1 p-4" data-testid="outreach-credit-balance">
      <p className="text-sm font-medium text-muted-foreground">
        Outreach credit
      </p>
      <p className="text-2xl font-semibold text-foreground">
        {formatOutreachCost(balanceCents)} left
      </p>
      {texts > 0 && (
        <p className="text-sm text-muted-foreground">
          {`About ${texts.toLocaleString()} texts at ${centsLabel(PRICE_PER_TEXT * 100)} each.`}
        </p>
      )}
    </Card>
  )
}
