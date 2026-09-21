import {
  ClipboardListIcon,
  DoorOpenIcon,
  MessageSquareMoreIcon,
  PhoneIcon,
} from '@styleguide'
import type { ListDetailReachability } from './contacts-types'

export type ReachabilityChannelKey = keyof ListDetailReachability

// The reachable-by-channel tiles on the list-detail sheet (locked
// design, ENG-10706/ENG-10707/ENG-10725; email/metaAds dropped in
// ENG-10783 — neither had an eligibility data source). Order and
// sentence-cased labels match the Lovable prototype ("Text" stays our
// product term for its "SMS"). Polls are delivered by text, so its count
// mirrors sms 1:1 (see ListDetailContacts.schema.ts).
export const REACHABILITY_CHANNELS: {
  key: ReachabilityChannelKey
  label: string
  icon: React.ReactNode
}[] = [
  {
    key: 'sms',
    label: 'Text',
    icon: <MessageSquareMoreIcon size={16} className="shrink-0" />,
  },
  {
    key: 'polls',
    label: 'Polls',
    icon: <ClipboardListIcon size={16} className="shrink-0" />,
  },
  {
    key: 'robocall',
    label: 'Robocall',
    icon: <PhoneIcon size={16} className="shrink-0" />,
  },
  {
    key: 'phoneBanking',
    label: 'Phone banking',
    icon: <PhoneIcon size={16} className="shrink-0" />,
  },
  {
    key: 'doorKnocking',
    label: 'Door knocking',
    icon: <DoorOpenIcon size={16} className="shrink-0" />,
  },
]

// Channels only a Win org can actually send. Robocall and text are the
// paid channels: Serve has no compliance or payment machinery behind
// either (see app/dashboard/constituent-outreach/AGENTS.md), so an
// elected official can never send one and the tiles advertised channels
// that do not exist for them. Polls stays for Serve even though its count
// mirrors sms 1:1 — a poll is a Serve product, and its count answers how
// many of the list one could reach with it.
const WIN_ONLY_CHANNEL_KEYS = new Set<ReachabilityChannelKey>([
  'robocall',
  'sms',
])

export const SERVE_REACHABILITY_CHANNELS = REACHABILITY_CHANNELS.filter(
  ({ key }) => !WIN_ONLY_CHANNEL_KEYS.has(key),
)
