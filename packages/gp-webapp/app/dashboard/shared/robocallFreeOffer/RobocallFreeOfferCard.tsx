import Link from 'next/link'
import { FreeOfferLabel } from './FreeOfferLabel'
import { Button, Card, cn } from '@styleguide'
import { FREE_OFFER_CARD_CLASS } from './freeOfferStyles'
import { useRobocallFreeOffer } from './useRobocallFreeOffer'
import {
  FREE_OFFER_CTA,
  FREE_OFFER_HOME_BODY,
  FREE_OFFER_TITLE,
} from './freeOfferCopy'
import { freeOfferHref } from './freeOfferHref'

// The free election-eve robocall offer on the legacy Home, above its task
// list. That Home has no single next task for the offer to lead, so it keeps
// a card of its own; the next-task Home shows the offer as its next task
// instead. Renders nothing unless gp-api says the campaign has the offer.
export default function RobocallFreeOfferCard(): React.JSX.Element | null {
  const { offer } = useRobocallFreeOffer()
  if (!offer) return null

  return (
    <Card
      className={cn(
        'w-full gap-2 rounded-2xl p-4 shadow-xs',
        FREE_OFFER_CARD_CLASS,
      )}
      data-testid="robocall-free-offer-card"
    >
      <FreeOfferLabel />
      <h3 className="text-base font-semibold">{FREE_OFFER_TITLE}</h3>
      <p className="text-sm text-muted-foreground">{FREE_OFFER_HOME_BODY}</p>
      <div className="mt-1 flex items-center justify-end gap-2">
        <Button size="small" asChild>
          <Link href={freeOfferHref('campaign_manager')}>{FREE_OFFER_CTA}</Link>
        </Button>
      </div>
    </Card>
  )
}
