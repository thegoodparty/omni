// No 'use client' directive: this is a plain presentational component with
// no hooks or browser-only APIs. It only ever renders inside
// ConstituentOutreachPage, which is already a Client Component — no new
// entry into the 'use client' ratchet is needed for it.
import { ChannelCard } from '@styleguide'
import {
  DoorOpenIcon,
  HeadphonesIcon,
  Share2Icon,
} from '@styleguide/components/ui/icons'

interface ServeChannelDefinition {
  key: string
  label: string
  icon: React.ReactNode
  iconClassName: string
}

// Icon + label per channel, read off the v2 hub's ChannelTileGrid/channelMeta
// (not imported — that grid is candidate-specific: swap flags, Pro gates,
// TaskFlow launches — and channelMeta is keyed on every OutreachType,
// including channels Serve doesn't have yet). No subCopy: the candidate
// grid's subCopy is per-message pricing, which doesn't apply here. Social is
// the first wired channel (ENG-10970); phone banking and door knocking stay
// disabled pending their own wiring tickets.
const SERVE_CHANNELS: ServeChannelDefinition[] = [
  {
    key: 'socialMedia',
    label: 'Social media',
    icon: <Share2Icon />,
    iconClassName: 'bg-secondary-light',
  },
  {
    key: 'phoneBanking',
    label: 'Phone banking',
    icon: <HeadphonesIcon />,
    iconClassName: 'bg-destructive-light',
  },
  {
    key: 'doorKnocking',
    label: 'Door knocking',
    icon: <DoorOpenIcon />,
    iconClassName: 'bg-success-light',
  },
]

interface ServeChannelCardsProps {
  onSocialClick: () => void
}

const ServeChannelCards = ({
  onSocialClick,
}: ServeChannelCardsProps): React.JSX.Element => (
  <section className="space-y-3">
    <div>
      <h2 className="text-lg font-semibold text-foreground">
        Outreach channels
      </h2>
      <p className="text-sm text-muted-foreground">
        Reach your constituents through these channels.
      </p>
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {SERVE_CHANNELS.map((channel) => (
        <ChannelCard
          key={channel.key}
          icon={channel.icon}
          iconClassName={channel.iconClassName}
          label={channel.label}
          disabled={channel.key !== 'socialMedia'}
          onClick={channel.key === 'socialMedia' ? onSocialClick : undefined}
        />
      ))}
    </div>
  </section>
)

export default ServeChannelCards
