import { Badge } from '@goodparty_org/styleguide'
import { type ChannelKey, CHANNEL_LABEL, CHANNEL_TINT } from './data'

// One channel badge, reused in the table, the mobile cards, and the drawer so the
// channel chip is identical everywhere. Styleguide Badge (pill) + a soft tint built
// only from styleguide auxiliary color tokens (see CHANNEL_TINT / NEW_COMPONENTS.md).
export const ChannelBadge = ({ channel }: { channel: ChannelKey }) => (
  <Badge shape="pill" className={CHANNEL_TINT[channel]}>
    {CHANNEL_LABEL[channel]}
  </Badge>
)
