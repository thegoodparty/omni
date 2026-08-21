import type { ReactNode } from 'react'
import { Badge, StatusText } from '@styleguide'
import {
  CalendarClockIcon,
  CheckCircleIcon,
  CircleDotIcon,
  ClockIcon,
  DoorOpenIcon,
  HeadphonesIcon,
  MessageSquareIcon,
  PencilIcon,
  PhoneIcon,
  Share2Icon,
  XCircleIcon,
} from '@styleguide/components/ui/icons'
import type { OutreachType } from 'gpApi/types/outreach.types'

// One meta row per channel, shared by the hub tiles, the history table's
// channel badge, and the details drawer so the channel reads identically
// everywhere (prototype: serve-nav-kit outreach data.ts).
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
    iconTint: 'bg-secondary-light',
    badgeTint: 'border-transparent bg-secondary-light text-foreground',
  },
  text: {
    label: 'SMS',
    icon: <MessageSquareIcon />,
    iconTint: 'bg-info-light',
    badgeTint: 'border-transparent bg-info-light text-foreground',
  },
  p2p: {
    label: 'SMS',
    icon: <MessageSquareIcon />,
    iconTint: 'bg-info-light',
    badgeTint: 'border-transparent bg-info-light text-foreground',
  },
  robocall: {
    label: 'Robocall',
    icon: <PhoneIcon />,
    iconTint: 'bg-warning-light',
    badgeTint: 'border-transparent bg-warning-light text-foreground',
  },
  phoneBanking: {
    label: 'Phone banking',
    icon: <HeadphonesIcon />,
    iconTint: 'bg-destructive-light',
    badgeTint: 'border-transparent bg-destructive-light text-foreground',
  },
  nativePhoneBanking: {
    label: 'Phone banking',
    icon: <HeadphonesIcon />,
    iconTint: 'bg-destructive-light',
    badgeTint: 'border-transparent bg-destructive-light text-foreground',
  },
  doorKnocking: {
    label: 'Door knocking',
    icon: <DoorOpenIcon />,
    iconTint: 'bg-success-light',
    badgeTint: 'border-transparent bg-success-light text-foreground',
  },
  // Same presentation as the legacy type: a candidate reading the history has
  // no use for the distinction between an eCanvasser draft and a native walk,
  // and a channel that renders two ways reads as two channels.
  nativeDoorKnocking: {
    label: 'Door knocking',
    icon: <DoorOpenIcon />,
    iconTint: 'bg-success-light',
    badgeTint: 'border-transparent bg-success-light text-foreground',
  },
}

export const getChannelLabel = (type: string | undefined): string => {
  if (!type) return ''
  return (
    CHANNEL_META[type as OutreachType]?.label ??
    type.charAt(0).toUpperCase() + type.slice(1)
  )
}

export const ChannelBadge = ({ type }: { type: string | undefined }) => (
  <Badge
    shape="pill"
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
  Scheduled: { icon: <CalendarClockIcon />, tone: 'primary' },
  'In progress': { icon: <CircleDotIcon />, tone: 'primary' },
  Done: { icon: <CheckCircleIcon />, tone: 'primary' },
  'Pending payment': { icon: <ClockIcon />, tone: 'warning' },
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
