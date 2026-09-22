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
// grid's subCopy is per-message pricing, which doesn't apply here.
//
// All three are wired now. Door knocking was the omission this comment used to
// record — it had no serve wiring at all, and a permanently disabled
// placeholder read as broken, so the card was removed rather than greyed out.
// Door knocking 3.0 gave it the two things it was missing: an outreach
// envelope on every turf, which is what lets a Serve rail exist separately
// from a Win one, and a `serve/turfs` pair to write and read it through.
//
// It is a navigation rather than a flow, which is why its handler is shaped
// differently from the other two: the door-knocking map is its own route, and
// the create flow lives inside it opening itself on an org with no lists.
//
// That route is also why the card is conditional. Win has a control arm behind
// `native-door-knocking` — the eCanvasser dashboard, which is what the route
// renders with the flag off — but Serve never had one: door knocking reached
// this rail already native, so for a flag-off Serve org the card's only
// destination is a Win-only legacy screen about an integration they have not
// connected. Hidden rather than disabled for the reason the placeholder was
// removed: a dead tile reads as broken.
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
    iconClassName: 'bg-primary-light',
  },
]

interface ServeChannelCardsProps {
  onSocialClick: () => void
  onPhoneBankingClick: () => void
  onDoorKnockingClick: () => void
  // Off until `native-door-knocking` resolves on, so an unsettled read shows
  // two cards rather than a third that leads somewhere wrong.
  showDoorKnocking: boolean
}

const ServeChannelCards = ({
  onSocialClick,
  onPhoneBankingClick,
  onDoorKnockingClick,
  showDoorKnocking,
}: ServeChannelCardsProps): React.JSX.Element => {
  const handlers: Record<string, () => void> = {
    socialMedia: onSocialClick,
    phoneBanking: onPhoneBankingClick,
    doorKnocking: onDoorKnockingClick,
  }
  const channels = SERVE_CHANNELS.filter(
    (channel) => channel.key !== 'doorKnocking' || showDoorKnocking,
  )
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Outreach channels
        </h2>
        <p className="text-sm text-muted-foreground">
          Reach your constituents through these channels.
        </p>
      </div>
      {/* Three cards, so three columns. The width cap goes with the second
          card: at `max-w-md` a third tile is narrower than the ~220px the
          candidate grid gives, and these are the same tiles. Two cards keep
          the same column width rather than stretching to fill the cap. */}
      <div className="grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3">
        {channels.map((channel) => (
          <ChannelCard
            key={channel.key}
            icon={channel.icon}
            iconClassName={channel.iconClassName}
            label={channel.label}
            onClick={handlers[channel.key]}
          />
        ))}
      </div>
    </section>
  )
}

export default ServeChannelCards
