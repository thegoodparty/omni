import { cn } from '@styleguide'
import { ExternalLinkIcon } from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { outreachChannel } from 'app/dashboard/outreach/util/outreachAnalytics'
import {
  communityResourceCta,
  communityResourceFor,
  type CommunityResourceChannel,
} from './communityResources'

interface CommunityResourceLinkProps {
  channel: CommunityResourceChannel
  // The purpose picked so far; null or undefined before the purpose step
  // answers, which reads as the channel's own training.
  purpose: string | null | undefined
  // Where the link is mounted, for the analytics property only.
  surface: 'flow' | 'caller'
  className?: string
}

// The one line of training beside an outreach action (communityResources.ts).
// Win only: callers gate it on their own Serve signal rather than this
// component carrying a mode, so a Serve surface never imports candidate copy.
export const CommunityResourceLink = ({
  channel,
  purpose,
  surface,
  className,
}: CommunityResourceLinkProps) => {
  const resource = communityResourceFor(channel, purpose)
  return (
    <p className={cn('text-sm text-muted-foreground', className)}>
      {resource.line}{' '}
      <a
        href={resource.href}
        target="_blank"
        rel="noreferrer"
        // Inline, not inline-flex, so the link wraps with the sentence as
        // text and follows the paragraph's alignment when it lands on its
        // own line (the caller header right-aligns it).
        className="whitespace-nowrap font-medium text-foreground underline underline-offset-4 hover:no-underline"
        onClick={() =>
          trackEvent(EVENTS.Outreach.CommunityResource.Opened, {
            channel,
            medium: outreachChannel(channel),
            purpose: purpose ?? null,
            resource: resource.id,
            surface,
            product: 'win',
          })
        }
      >
        {communityResourceCta(resource.kind)}
        <ExternalLinkIcon
          className="ml-1 inline size-3.5 align-[-2px]"
          aria-hidden
        />
      </a>
    </p>
  )
}
