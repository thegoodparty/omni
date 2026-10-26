import Link from 'next/link'
import { Button, Card, GiftIcon, cn } from '@styleguide'
import {
  FREE_OFFER_CARD_CLASS,
  FREE_OFFER_EYEBROW_CLASS,
} from './freeOfferStyles'
import { useRobocallFreeOffer } from './useRobocallFreeOffer'
import {
  FREE_OFFER_BADGE,
  FREE_OFFER_HOME_BODY,
  FREE_OFFER_TITLE,
} from './freeOfferCopy'
import { freeOfferHref } from './freeOfferHref'

// The free election-eve robocall offer on Home, beside the next task. The
// plan task is backlog-first, so it is often not the next task; this card is
// what keeps the offer in front of the candidate. Renders nothing unless
// gp-api says the campaign has the offer.
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
      <p
        className={cn(
          'flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider',
          FREE_OFFER_EYEBROW_CLASS,
        )}
      >
        <GiftIcon className="size-3.5" aria-hidden />
        {FREE_OFFER_BADGE}
      </p>
      <h3 className="text-base font-semibold">{FREE_OFFER_TITLE}</h3>
      <p className="text-sm text-muted-foreground">{FREE_OFFER_HOME_BODY}</p>
      <div className="mt-1 flex justify-end">
        <Button size="small" asChild>
          <Link href={freeOfferHref('campaign_manager')}>Start outreach</Link>
        </Button>
      </div>
    </Card>
  )
}
