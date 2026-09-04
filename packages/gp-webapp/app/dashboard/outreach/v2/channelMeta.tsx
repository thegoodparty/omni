import type { ReactNode } from 'react'
import { Badge, StatusText } from '@styleguide'
import {
  ArchiveIcon,
  CalendarClockIcon,
  CheckCircleIcon,
  CircleDotIcon,
  CircleIcon,
  ClockIcon,
  DoorOpenIcon,
  HeadphonesIcon,
  MessageSquareIcon,
  PencilIcon,
  PhoneIcon,
  Share2Icon,
  XCircleIcon,
  ShieldAlertIcon,
} from '@styleguide/components/ui/icons'
import type { OutreachType } from 'gpApi/types/outreach.types'

// One meta row per channel, shared by the hub tiles, the history table's
// channel badge, and the details drawer so the channel reads identically
// everywhere (prototype: serve-nav-kit outreach data.ts).
//
// `badgeTint` and `iconTint` both use BRAND-PALETTE tokens rather than
// semantic role tokens (`destructive-light`, `info-light`, …) so a retune
// of `destructive` for error surfaces does not silently recolour phone
// banking. The two are kept ONE-TO-ONE on the same brand shade — the
// tile's icon circle and the row's badge must look like the same channel
// speaking, not two different ones — following one shade pair:
// `bg-brand-<palette>-100` background, `text-brand-<palette>-800`
// foreground (700 where 800 tests too dark). Add a new channel by picking
// an unused brand palette from `tailwind-theme.css` and using the same
// pair for both fields.
interface ChannelMeta {
  label: string
  icon: ReactNode
  // Icon-circle background — same color family as the badge tint; the glyph
  // color is constant so every icon reads the same.
  iconTint: string
  badgeTint: string
}

export const CHANNEL_META: Record<OutreachType, ChannelMeta> = {
  socialMedia: {
    label: 'Social media',
    icon: <Share2Icon />,
    iconTint: 'bg-brand-lavender-100',
    badgeTint:
      'border-transparent bg-brand-lavender-100 text-brand-lavender-800',
  },
  text: {
    label: 'SMS',
    icon: <MessageSquareIcon />,
    iconTint: 'bg-brand-blue-100',
    badgeTint: 'border-transparent bg-brand-blue-100 text-brand-blue-800',
  },
  p2p: {
    label: 'SMS',
    icon: <MessageSquareIcon />,
    iconTint: 'bg-brand-blue-100',
    badgeTint: 'border-transparent bg-brand-blue-100 text-brand-blue-800',
  },
  robocall: {
    label: 'Robocall',
    icon: <PhoneIcon />,
    iconTint: 'bg-brand-waxflower-100',
    badgeTint:
      'border-transparent bg-brand-waxflower-100 text-brand-waxflower-700',
  },
  phoneBanking: {
    label: 'Phone banking',
    icon: <HeadphonesIcon />,
    iconTint: 'bg-brand-red-100',
    badgeTint: 'border-transparent bg-brand-red-100 text-brand-red-800',
  },
  nativePhoneBanking: {
    label: 'Phone banking',
    icon: <HeadphonesIcon />,
    iconTint: 'bg-brand-red-100',
    badgeTint: 'border-transparent bg-brand-red-100 text-brand-red-800',
  },
  doorKnocking: {
    label: 'Door knocking',
    icon: <DoorOpenIcon />,
    iconTint: 'bg-brand-halo-green-100',
    badgeTint:
      'border-transparent bg-brand-halo-green-100 text-brand-halo-green-800',
  },
  // Same presentation as the legacy type: a candidate reading the history has
  // no use for the distinction between an eCanvasser draft and a native walk,
  // and a channel that renders two ways reads as two channels.
  nativeDoorKnocking: {
    label: 'Door knocking',
    icon: <DoorOpenIcon />,
    iconTint: 'bg-brand-halo-green-100',
    badgeTint:
      'border-transparent bg-brand-halo-green-100 text-brand-halo-green-800',
  },
}

export const getChannelLabel = (type: string | undefined): string => {
  if (!type) return ''
  return (
    CHANNEL_META[type as OutreachType]?.label ??
    type.charAt(0).toUpperCase() + type.slice(1)
  )
}

// Default badge shape (px-2.5 py-1 + rounded-full since the styleguide's
// own default) for legible label padding. The `shape="pill"` variant
// (h-5 px-1.5) is intentionally tight for numeric notification chips and
// reads as a compressed capsule around channel words like "Phone banking".
export const ChannelBadge = ({ type }: { type: string | undefined }) => (
  <Badge
    className={
      CHANNEL_META[type as OutreachType]?.badgeTint ??
      'border-transparent bg-muted text-foreground'
    }
  >
    {getChannelLabel(type)}
  </Badge>
)

const STATUS_DISPLAY: Record<
  string,
  { icon: ReactNode; tone: 'primary' | 'destructive' | 'warning' | 'muted' }
> = {
  Draft: { icon: <PencilIcon />, tone: 'muted' },
  'In review': { icon: <ClockIcon />, tone: 'primary' },
  Denied: { icon: <XCircleIcon />, tone: 'destructive' },
  // A send that has been bought and has a real send time on it. Sending
  // channels only — a door-knocking list is never scheduled, because there is
  // nothing to schedule; see 'Not started' below.
  Scheduled: { icon: <CalendarClockIcon />, tone: 'primary' },
  // The un-begun end of the same axis as 'In progress' and 'Done', and door
  // knocking's alone: no other channel has a state between "composed" and
  // "sending" that isn't already Draft, In review or Scheduled. Its icon is the
  // empty circle those two fill in and then tick, so the three read as one
  // progression rather than three unrelated marks. `turfStatusLabel`
  // (door-knocking/native/turfLifecycle.ts) is the only producer.
  'Not started': { icon: <CircleIcon />, tone: 'muted' },
  'In progress': { icon: <CircleDotIcon />, tone: 'primary' },
  Done: { icon: <CheckCircleIcon />, tone: 'primary' },
  'Pending payment': { icon: <ClockIcon />, tone: 'warning' },
  Canceled: { icon: <XCircleIcon />, tone: 'muted' },
  // A robocall the send chain could not deliver (a CallHub failure). The
  // candidate was not charged; destructive tone marks it as needing attention.
  "Couldn't send": { icon: <ShieldAlertIcon />, tone: 'destructive' },
  // Shelved, not finished. No history row carries this label yet — the archive
  // transition is reached from the door-knocking rail, whose details drawer
  // renders this same component so one saved list is described the same way
  // from both entry points — but gp-api stamps `archivedAt` on the outreach
  // envelope in the same transaction as the turf, so the state is the table's
  // too.
  Archived: { icon: <ArchiveIcon />, tone: 'muted' },
}

export const HistoryStatusText = ({ label }: { label: string | null }) => {
  if (!label) {
    return <StatusText tone="muted">n/a</StatusText>
  }
  const display = STATUS_DISPLAY[label]
  return (
    <StatusText tone={display?.tone ?? 'primary'} icon={display?.icon}>
      {label}
    </StatusText>
  )
}
