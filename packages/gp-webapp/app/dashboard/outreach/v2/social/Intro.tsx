import type { OutreachType } from 'gpApi/types/outreach.types'
import { ChannelBadge } from '../channelMeta'

// The channel pill replaces the header title as the flow's channel context
// (the sheet header carries only back/close + stepper, per the prototype).
export const Intro = ({
  channel,
  title,
  body,
}: {
  channel: OutreachType
  title: string
  body: string
}) => (
  <div className="space-y-2">
    <ChannelBadge type={channel} />
    <h3 className="text-xl font-semibold text-foreground">{title}</h3>
    <p className="text-base text-muted-foreground">{body}</p>
  </div>
)
