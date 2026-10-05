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
  nativeDoorKnocking: 'Knocked',
  phoneBanking: 'Called',
  nativePhoneBanking: 'Called',
  robocall: 'Called',
  socialMedia: 'Digital',
}

// Channel NAMES for surfaces that answer "which channel is this" (the list
// detail's Channel column and Last-method tile) — the verb map above answers
// "what did we do to this person" and stays the activity-feed vocabulary
// (ENG-10769: reusing the verbs as channel names rendered a robocall's
// Channel as "Called").
export const OUTREACH_CHANNEL_NOUNS: Record<OutreachChannel, string> = {
  text: 'Text',
  p2p: 'Text',
  doorKnocking: 'Door knocking',
  nativeDoorKnocking: 'Door knocking',
  phoneBanking: 'Phone banking',
  nativePhoneBanking: 'Phone banking',
  robocall: 'Robocall',
  socialMedia: 'Social post',
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
    nativeDoorKnocking: (
      <DoorOpenIcon size={16} className="shrink-0 text-foreground" />
    ),
    phoneBanking: <PhoneIcon size={16} className="shrink-0 text-foreground" />,
    nativePhoneBanking: (
      <PhoneIcon size={16} className="shrink-0 text-foreground" />
    ),
    robocall: <PhoneIcon size={16} className="shrink-0 text-foreground" />,
    socialMedia: <Share2Icon size={16} className="shrink-0 text-foreground" />,
  }
