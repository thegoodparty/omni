// No 'use client' directive: this is a plain presentational component with
// no hooks or browser-only APIs. It only ever renders inside
// ConstituentOutreachPage, which is already a Client Component — no new
// entry into the 'use client' ratchet is needed for it.
import { ChannelCard } from '@styleguide'
import {
  DoorOpenIcon,
  HeadsetIcon,
  MessageSquareIcon,
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
// All four are wired. Door knocking was the omission this comment used to
// record — it had no serve wiring at all, and a permanently disabled
// placeholder read as broken, so the card was removed rather than greyed out.
// Door knocking 3.0 gave it the two things it was missing: an outreach
// envelope on every turf, which is what lets a Serve rail exist separately
// from a Win one, and a `serve/turfs` pair to write and read it through.
//
// Door knocking is a navigation rather than a flow, which is why its handler
// is shaped differently from the others: the door-knocking map is its own
// route, and the create flow lives inside it, opening itself on an org with
// no lists.
//
// That route is also why its card is conditional. Win has a control arm behind
// `native-door-knocking` — the eCanvasser dashboard, which is what the route
// renders with the flag off — but Serve never had one: door knocking reached
// this rail already native, so for a flag-off Serve org the card's only
// destination is a Win-only legacy screen about an integration they have not
// connected.
//
// SMS is gated too, by `serve-sms-outreach`, but differently: the page reads
// that flag and passes a handler only once it has resolved on, so this stays
// hookless. Both cards are hidden rather than disabled, for the same reason
// the placeholder was removed — a dead tile reads as broken.
const SERVE_CHANNELS: ServeChannelDefinition[] = [
  {
    key: 'socialMedia',
    label: 'Social media',
    icon: <Share2Icon />,
    iconClassName: 'bg-secondary-light',
  },
  // Second, matching the candidate grid's TILE_ORDER, where texting sits
  // right after social. Label and icon are the history table's
  // CHANNEL_META.text pair so the card and the row badge read as the same
  // channel, and the blue tint is the same family as that badge's
  // `bg-brand-blue-100` — expressed here as the semantic token the other
  // three cards on this page use.
  {
    key: 'sms',
    label: 'SMS',
    icon: <MessageSquareIcon />,
    iconClassName: 'bg-info-light',
  },
  {
    key: 'phoneBanking',
    label: 'Phone banking',
    icon: <HeadsetIcon />,
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
  // SMS is behind the `serve-sms-outreach` flag, and the flag is read by the
  // page rather than here so this stays a hookless presentational component
  // outside the 'use client' ratchet. Undefined means "no SMS on this
  // render" — flag off, or still resolving.
  onSmsClick?: () => void
  // Off until `native-door-knocking` resolves on, so an unsettled read shows
  // two cards rather than a third that leads somewhere wrong.
  showDoorKnocking: boolean
}

const ServeChannelCards = ({
  onSocialClick,
  onPhoneBankingClick,
  onDoorKnockingClick,
  onSmsClick,
  showDoorKnocking,
}: ServeChannelCardsProps): React.JSX.Element => {
  const handlers: Record<string, (() => void) | undefined> = {
    socialMedia: onSocialClick,
    sms: onSmsClick,
    phoneBanking: onPhoneBankingClick,
    doorKnocking: onDoorKnockingClick,
  }
  // Two independent gates: a channel needs a handler at all (which is how
  // SMS is switched off, since the page omits it until its flag resolves on),
  // and door knocking additionally needs its own flag.
  const channels = SERVE_CHANNELS.filter(
    (channel) =>
      Boolean(handlers[channel.key]) &&
      (channel.key !== 'doorKnocking' || showDoorKnocking),
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
      {/* One column per card, and the width cap grows with the count. Two
          flags now move that count — SMS on, door knocking off — so it can
          be anywhere from two to four. At `max-w-md` a third tile is
          narrower than the ~220px the candidate grid gives, and these are
          the same tiles; `max-w-3xl`/3 and `max-w-4xl`/4 both land near it,
          so the tiles stay the same size whichever flags this org has. Two
          cards keep the three-column width rather than stretching to fill
          the cap. Both class strings are written out in full because
          Tailwind scans source text and never sees an interpolated one. */}
      <div
        className={
          channels.length > 3
            ? 'grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4'
            : 'grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3'
        }
      >
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
