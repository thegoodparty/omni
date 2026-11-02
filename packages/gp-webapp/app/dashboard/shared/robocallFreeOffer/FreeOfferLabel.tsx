import { GiftIcon, Overline, cn } from '@styleguide'
import { FREE_OFFER_BADGE } from './freeOfferCopy'

// Sized like Voter Data's "Recommended" label, so the free offer reads as the
// same kind of tag on every surface that shows it.
export const FreeOfferLabel = ({
  className,
  icon = true,
}: {
  className?: string
  icon?: boolean
}) => (
  <Overline
    className={cn(
      'flex items-center gap-1.5 text-[10px] tracking-wider',
      className,
    )}
  >
    {icon && <GiftIcon className="size-3.5" aria-hidden />}
    {FREE_OFFER_BADGE}
  </Overline>
)
