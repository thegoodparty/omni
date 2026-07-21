import {
  DoorOpenIcon,
  MailIcon,
  MessageSquareMoreIcon,
  PhoneIcon,
  Share2Icon,
} from '@styleguide'
import type { ListDetailReachability } from './contacts-types'

export type ReachabilityChannelKey = keyof ListDetailReachability

// The six reachable-by-channel tiles on the list-detail sheet (locked
// design, ENG-10706/ENG-10707/ENG-10725). Order and sentence-cased labels
// match the Lovable prototype ("Text" stays our product term for its "SMS").
// email/metaAds always render from a `null` reachability value (no
// eligibility data source exists yet — see ListDetailContacts.schema.ts) —
// ReachabilityGrid renders null as "Unavailable", never 0.
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
    key: 'email',
    label: 'Email',
    icon: <MailIcon size={16} className="shrink-0" />,
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
  {
    key: 'metaAds',
    label: 'Meta ads',
    icon: <Share2Icon size={16} className="shrink-0" />,
  },
]
