'use client'

import { Badge, cn } from '@styleguide'
import { useCampaign } from '@shared/hooks/useCampaign'
import { countdownFor } from './nextThingCopy'
import { useHomeHeadline } from './useHomeHeadline'

/**
 * Home's greeting: the session's headline, set in the marketing site's display
 * face so Home speaks in the brand's voice, under the days left to the next
 * election. It names the next-thing card's landmark (#next-thing-heading).
 */
export default function HomeGreeting(): React.JSX.Element {
  const headline = useHomeHeadline()
  const [campaign] = useCampaign()
  const ready = headline !== null
  // Today is the browser's, so the countdown waits for the client like the
  // headline does; the server's clock and time zone would mismatch.
  const countdown = ready ? countdownFor(campaign, new Date()) : null

  // Until the client fills them in, a blank headline and an invisible badge
  // hold the height.
  return (
    <div className="flex flex-col items-center gap-3 pb-6 pt-2 text-center lg:pb-10 lg:pt-6">
      {(countdown || !ready) && (
        <Badge
          variant="outline"
          className={cn(
            'bg-card font-normal text-muted-foreground',
            !ready && 'invisible',
          )}
        >
          {countdown ?? ' '}
        </Badge>
      )}
      <h2
        id="next-thing-heading"
        className="text-balance font-outfit text-3xl font-semibold text-foreground lg:text-4xl"
      >
        {headline ?? ' '}
      </h2>
    </div>
  )
}
