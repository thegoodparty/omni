import {
  ClipboardListIcon,
  DoorOpenIcon,
  MessageSquareMoreIcon,
  PhoneIcon,
} from '@styleguide'
import type { ListDetailReachability } from './contacts-types'

// `fenced` is a sibling map of per-channel flags, not a channel itself.
export type ReachabilityChannelKey = Exclude<
  keyof ListDetailReachability,
  'fenced'
>

// The five reachable-by-channel tiles on the list-detail sheet (locked
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
