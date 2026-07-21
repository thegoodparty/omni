import {
  DoorOpenIcon,
  MessageSquareMoreIcon,
  PhoneIcon,
  Share2Icon,
} from '@styleguide'
import type { OutreachChannel } from './contacts-types'

// Honest send-time labels per channel. v1 outreach attribution is send-time
// (segmentDerived) for everything except door knocking (per-recipient), so the
// label says what we did, not what was delivered. Extracted from
// PersonOverlay.tsx (ENG-10707) so the lists table + list-detail outreach
// history can render the same channel labels/icons without redeclaring them.
export const OUTREACH_CHANNEL_LABELS: Record<OutreachChannel, string> = {
  text: 'Texted',
  p2p: 'Texted',
  doorKnocking: 'Knocked',
  phoneBanking: 'Called',
  robocall: 'Called',
  socialMedia: 'Digital',
}

export const OUTREACH_CHANNEL_ICONS: Record<OutreachChannel, React.ReactNode> =
  {
    text: (
      <MessageSquareMoreIcon size={16} className="shrink-0 text-foreground" />
    ),
    p2p: (
      <MessageSquareMoreIcon size={16} className="shrink-0 text-foreground" />
    ),
    doorKnocking: (
      <DoorOpenIcon size={16} className="shrink-0 text-foreground" />
    ),
    phoneBanking: <PhoneIcon size={16} className="shrink-0 text-foreground" />,
    robocall: <PhoneIcon size={16} className="shrink-0 text-foreground" />,
    socialMedia: <Share2Icon size={16} className="shrink-0 text-foreground" />,
  }
